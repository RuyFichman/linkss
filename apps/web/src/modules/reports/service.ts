import { AuthorizationError, isUuid, requireUser, requireWorkspaceAccess, type IdentityPort } from "@/modules/identity/guard";
import { parseReportLinkInput, type ReportLinkErrorKind, type ReportLinkField, type ReportLinkInput, type ReportLinkSummary } from "./links";

/**
 * Management side of report links (ADR 0013): create, list and revoke. Authorization happens here
 * first (membership re-read per request, owners and admins only) and again in RLS and in the
 * security definer RPCs. The token exists in this process only between its generation and the
 * answer to the person who asked for it; the database receives its hash.
 */
export type ReportLinkCommandError = ReportLinkErrorKind | "unauthenticated";
export type ReportLinkResult<T> = { ok: true; value: T } | { ok: false; error: ReportLinkCommandError; field?: ReportLinkField };
export type ReportLinkRepositoryResult<T> = { ok: true; value: T } | { ok: false; error: ReportLinkErrorKind };

/** Persistence port. The Supabase implementation runs as the signed-in user, under RLS. */
export interface ReportLinksRepository {
  findProfileWorkspace(profileId: string): Promise<string | null>;
  /** Workspace of a link the caller may see (RLS: owners and admins of that workspace), or null. */
  findLinkWorkspace(linkId: string): Promise<string | null>;
  createLink(input: { profileId: string; tokenHash: string } & ReportLinkInput): Promise<ReportLinkRepositoryResult<{ id: string; expiresAt: string }>>;
  revokeLink(linkId: string): Promise<ReportLinkRepositoryResult<null>>;
  listLinks(profileId: string): Promise<ReportLinkRepositoryResult<ReportLinkSummary[]>>;
}

export interface ReportTokenPort {
  generate(): string;
  hash(token: string): string;
}

export function createReportLinksService(identity: IdentityPort, repository: ReportLinksRepository, tokens: ReportTokenPort) {
  function failure<T>(error: unknown): ReportLinkResult<T> {
    if (!(error instanceof AuthorizationError)) throw error;
    return { ok: false, error: error.reason };
  }

  async function authorizeProfile(profileId: unknown, action: "reports.view" | "reports.create"): Promise<string> {
    await requireUser(identity);
    if (!isUuid(profileId)) throw new AuthorizationError("not_found");
    const workspaceId = await repository.findProfileWorkspace(profileId);
    if (!workspaceId) throw new AuthorizationError("not_found");
    await requireWorkspaceAccess(identity, workspaceId, action);
    return profileId;
  }

  return {
    /**
     * Creates a link for one page and returns its token, once. `historyDays` is the workspace's
     * `analytics_days` entitlement as the page read it; the database checks the period again.
     */
    async create(profileId: unknown, raw: { period: unknown; expires: unknown; label: unknown }, historyDays: number): Promise<ReportLinkResult<{ token: string; expiresAt: string }>> {
      let authorized: string;
      try {
        authorized = await authorizeProfile(profileId, "reports.create");
      } catch (error) {
        return failure(error);
      }
      const input = parseReportLinkInput(raw, historyDays);
      if (!input.ok) return { ok: false, error: "invalid", field: input.field };
      const token = tokens.generate();
      const created = await repository.createLink({ profileId: authorized, tokenHash: tokens.hash(token), ...input.value });
      if (!created.ok) return created;
      return { ok: true, value: { token, expiresAt: created.value.expiresAt } };
    },

    async revoke(linkId: unknown): Promise<ReportLinkResult<null>> {
      try {
        await requireUser(identity);
        if (!isUuid(linkId)) throw new AuthorizationError("not_found");
        // RLS hides links of other workspaces and from editors, so "cannot see" is "not found".
        const workspaceId = await repository.findLinkWorkspace(linkId);
        if (!workspaceId) throw new AuthorizationError("not_found");
        await requireWorkspaceAccess(identity, workspaceId, "reports.revoke");
      } catch (error) {
        return failure(error);
      }
      return repository.revokeLink(linkId as string);
    },

    /** Links of one page, for owners and admins. Never contains a token or its hash. */
    async list(profileId: unknown): Promise<ReportLinkResult<ReportLinkSummary[]>> {
      let authorized: string;
      try {
        authorized = await authorizeProfile(profileId, "reports.view");
      } catch (error) {
        return failure(error);
      }
      return repository.listLinks(authorized);
    },
  };
}
