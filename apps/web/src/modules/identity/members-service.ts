import { AuthorizationError, isUuid, requireUser, requireWorkspaceAccess, type IdentityPort } from "./guard";
import {
  acceptOutcome,
  invitationViewState,
  isInvitationToken,
  isValidInvitationEmail,
  normalizeInvitationEmail,
  type AcceptOutcome,
  type InvitationViewState,
  type MemberErrorKind,
} from "./invitations";
import { WORKSPACE_ROLES, canChangeRole, canInvite, canRemoveMember, type InvitableRole, type WorkspaceRole } from "./permissions";

export interface MembershipRef {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  status: "invited" | "active" | "revoked";
}

export interface MemberSummary {
  membershipId: string;
  userId: string;
  role: WorkspaceRole;
  displayName: string | null;
  /** Null unless the caller is an owner or admin, or it is the caller's own row. */
  email: string | null;
  joinedAt: string;
  isSelf: boolean;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: InvitableRole;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  acceptedAt: string | null;
}

export interface InvitationPreview {
  state: InvitationViewState;
  workspaceId: string | null;
  workspaceName: string | null;
  role: WorkspaceRole | null;
  inviterName: string | null;
  expiresAt: string | null;
}

export type MembersRepositoryResult<T> = { ok: true; value: T } | { ok: false; error: MemberErrorKind };

/** Persistence port. The Supabase implementation runs as the signed-in user, under RLS. */
export interface MembersRepository {
  findMembership(membershipId: string): Promise<MembershipRef | null>;
  findInvitationWorkspace(invitationId: string): Promise<string | null>;
  createInvitation(input: { workspaceId: string; email: string; role: InvitableRole; tokenHash: string }): Promise<MembersRepositoryResult<{ id: string; expiresAt: string }>>;
  revokeInvitation(invitationId: string): Promise<MembersRepositoryResult<null>>;
  changeRole(membershipId: string, role: WorkspaceRole): Promise<MembersRepositoryResult<null>>;
  remove(membershipId: string): Promise<MembersRepositoryResult<null>>;
  previewInvitation(token: string): Promise<MembersRepositoryResult<{ state: unknown; workspaceId: string | null; workspaceName: string | null; role: WorkspaceRole | null; inviterName: string | null; expiresAt: string | null }>>;
  acceptInvitation(token: string): Promise<MembersRepositoryResult<{ state: unknown; workspaceId: string | null }>>;
}

export interface TokenTools {
  generate(): string;
  hash(token: string): string;
}

export type MemberCommandError = MemberErrorKind | "unauthenticated";
export type MemberCommandResult<T> = { ok: true; value: T } | { ok: false; error: MemberCommandError };

function authorizationFailure<T>(error: unknown): MemberCommandResult<T> {
  if (!(error instanceof AuthorizationError)) throw error;
  if (error.reason === "unauthenticated") return { ok: false, error: "unauthenticated" };
  return { ok: false, error: error.reason === "forbidden" ? "forbidden" : "not_found" };
}

const INVALID_PREVIEW: InvitationPreview = { state: "invalid", workspaceId: null, workspaceName: null, role: null, inviterName: null, expiresAt: null };

/**
 * Member and invitation commands (ADR 0012). The workspace always comes from the request URL and
 * is checked against the caller's membership here, then again by the database function. Ids of
 * memberships and invitations are resolved to their workspace in the database and compared with
 * the URL's: a row of another workspace is "not found".
 */
export function createMembersService(identity: IdentityPort, repository: MembersRepository, tokens: TokenTools) {
  return {
    /** The token is returned once, to be shown to the inviter; only its hash is stored. */
    async invite(workspaceId: unknown, input: { email: unknown; role: unknown }): Promise<MemberCommandResult<{ token: string; email: string; role: InvitableRole; expiresAt: string }>> {
      let access;
      try {
        access = await requireWorkspaceAccess(identity, workspaceId, "members.invite");
      } catch (error) {
        return authorizationFailure(error);
      }
      // Ownership is never granted by invitation, whoever asks.
      if (!canInvite(access.role, input.role)) return { ok: false, error: "forbidden" };
      const email = normalizeInvitationEmail(typeof input.email === "string" ? input.email : "");
      if (!isValidInvitationEmail(email)) return { ok: false, error: "invalid_email" };

      const token = tokens.generate();
      const created = await repository.createInvitation({ workspaceId: access.workspaceId, email, role: input.role, tokenHash: tokens.hash(token) });
      if (!created.ok) return created;
      return { ok: true, value: { token, email, role: input.role, expiresAt: created.value.expiresAt } };
    },

    async revokeInvitation(workspaceId: unknown, invitationId: unknown): Promise<MemberCommandResult<null>> {
      let access;
      try {
        access = await requireWorkspaceAccess(identity, workspaceId, "invitations.revoke");
      } catch (error) {
        return authorizationFailure(error);
      }
      if (!isUuid(invitationId)) return { ok: false, error: "not_found" };
      if ((await repository.findInvitationWorkspace(invitationId)) !== access.workspaceId) return { ok: false, error: "not_found" };
      return repository.revokeInvitation(invitationId);
    },

    async changeRole(workspaceId: unknown, membershipId: unknown, role: unknown): Promise<MemberCommandResult<null>> {
      let access;
      try {
        access = await requireWorkspaceAccess(identity, workspaceId, "members.change_role");
      } catch (error) {
        return authorizationFailure(error);
      }
      if (!isUuid(membershipId)) return { ok: false, error: "not_found" };
      const target = await repository.findMembership(membershipId);
      if (!target || target.workspaceId !== access.workspaceId || target.status !== "active") return { ok: false, error: "not_found" };
      const next = WORKSPACE_ROLES.find((candidate) => candidate === role);
      if (!next || !canChangeRole(access.role, target.role, next)) return { ok: false, error: "forbidden" };
      return repository.changeRole(target.id, next);
    },

    /** Removes someone else (owners and admins) or oneself (anyone, except the last owner). */
    async remove(workspaceId: unknown, membershipId: unknown): Promise<MemberCommandResult<{ self: boolean }>> {
      let access;
      try {
        access = await requireWorkspaceAccess(identity, workspaceId, "members.view");
      } catch (error) {
        return authorizationFailure(error);
      }
      if (!isUuid(membershipId)) return { ok: false, error: "not_found" };
      const target = await repository.findMembership(membershipId);
      if (!target || target.workspaceId !== access.workspaceId || target.status !== "active") return { ok: false, error: "not_found" };
      const self = target.userId === access.userId;
      if (!canRemoveMember(access.role, target.role, self)) return { ok: false, error: "forbidden" };
      const removed = await repository.remove(target.id);
      return removed.ok ? { ok: true, value: { self } } : removed;
    },

    /** What the acceptance screen shows. A malformed token never reaches the database. */
    async previewInvitation(token: unknown): Promise<MemberCommandResult<InvitationPreview>> {
      try {
        await requireUser(identity);
      } catch (error) {
        return authorizationFailure(error);
      }
      if (!isInvitationToken(token)) return { ok: true, value: INVALID_PREVIEW };
      const found = await repository.previewInvitation(token);
      // A failed lookup is shown as the same generic state: nothing about the token is revealed.
      if (!found.ok) return found.error === "unavailable" ? found : { ok: true, value: INVALID_PREVIEW };
      const state = invitationViewState(found.value.state);
      if (state === "invalid" || state === "wrong_account") return { ok: true, value: { ...INVALID_PREVIEW, state } };
      return { ok: true, value: { state, workspaceId: found.value.workspaceId, workspaceName: found.value.workspaceName, role: found.value.role, inviterName: found.value.inviterName, expiresAt: found.value.expiresAt } };
    },

    async acceptInvitation(token: unknown): Promise<MemberCommandResult<{ outcome: AcceptOutcome; workspaceId: string | null }>> {
      try {
        await requireUser(identity);
      } catch (error) {
        return authorizationFailure(error);
      }
      if (!isInvitationToken(token)) return { ok: true, value: { outcome: "invalid", workspaceId: null } };
      const accepted = await repository.acceptInvitation(token);
      if (!accepted.ok) return accepted.error === "unavailable" ? accepted : { ok: true, value: { outcome: "invalid", workspaceId: null } };
      const outcome = acceptOutcome(accepted.value.state);
      const workspaceId = (outcome === "accepted" || outcome === "already_member") && isUuid(accepted.value.workspaceId) ? accepted.value.workspaceId : null;
      // "Accepted" without a workspace would be a broken answer: treat it as a refusal.
      if (outcome === "accepted" && !workspaceId) return { ok: true, value: { outcome: "invalid", workspaceId: null } };
      return { ok: true, value: { outcome, workspaceId } };
    },
  };
}

export type MembersService = ReturnType<typeof createMembersService>;
