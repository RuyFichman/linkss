import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { generateInvitationToken, hashInvitationToken } from "./invitation-token";
import { memberErrorFromDatabase, parseInvitableRole, type MemberErrorKind } from "./invitations";
import { createMembersService, type InvitationSummary, type MemberSummary, type MembersRepository } from "./members-service";
import { getSupabase, supabaseIdentity } from "./session";

// Bounded even though no plan allows more than a handful of people per workspace.
const INVITATION_LIST_LIMIT = 100;

/** Runs as the signed-in user: reads are filtered by RLS and every write is a checked RPC. */
export function createSupabaseMembersRepository(supabase: SupabaseServerClient): MembersRepository {
  return {
    async findMembership(membershipId) {
      const { data, error } = await supabase.from("workspace_memberships").select("id, workspace_id, user_id, role, status").eq("id", membershipId).maybeSingle();
      if (error) throw new Error(`Membership lookup failed: ${error.code}`);
      return data ? { id: data.id, workspaceId: data.workspace_id, userId: data.user_id, role: data.role, status: data.status } : null;
    },

    async findInvitationWorkspace(invitationId) {
      const { data, error } = await supabase.from("workspace_invitations").select("workspace_id").eq("id", invitationId).maybeSingle();
      // Before the migration, or for a row RLS hides, the answer is the same: there is no such invitation.
      return error ? null : data?.workspace_id ?? null;
    },

    async createInvitation(input) {
      const { data, error } = await supabase
        .rpc("create_workspace_invitation", { p_workspace_id: input.workspaceId, p_email: input.email, p_role: input.role, p_token_hash: input.tokenHash })
        .single();
      return error ? { ok: false, error: memberErrorFromDatabase(error) } : { ok: true, value: { id: data.invitation_id, expiresAt: data.expires_at } };
    },

    async revokeInvitation(invitationId) {
      const { error } = await supabase.rpc("revoke_workspace_invitation", { p_invitation_id: invitationId });
      return error ? { ok: false, error: memberErrorFromDatabase(error) } : { ok: true, value: null };
    },

    async changeRole(membershipId, role) {
      const { error } = await supabase.rpc("change_member_role", { p_membership_id: membershipId, p_role: role });
      return error ? { ok: false, error: memberErrorFromDatabase(error) } : { ok: true, value: null };
    },

    async remove(membershipId) {
      const { error } = await supabase.rpc("remove_workspace_member", { p_membership_id: membershipId });
      return error ? { ok: false, error: memberErrorFromDatabase(error) } : { ok: true, value: null };
    },

    async previewInvitation(token) {
      const { data, error } = await supabase.rpc("get_workspace_invitation", { p_token: token }).maybeSingle();
      if (error) return { ok: false, error: memberErrorFromDatabase(error) };
      // The generated types mark every column as present; refusals leave all but `state` null.
      const row = data as { state: unknown; workspace_id: string | null; workspace_name: string | null; role: MembersRole | null; inviter_name: string | null; expires_at: string | null } | null;
      return { ok: true, value: { state: row?.state, workspaceId: row?.workspace_id ?? null, workspaceName: row?.workspace_name ?? null, role: row?.role ?? null, inviterName: row?.inviter_name ?? null, expiresAt: row?.expires_at ?? null } };
    },

    async acceptInvitation(token) {
      const { data, error } = await supabase.rpc("accept_workspace_invitation", { p_token: token }).maybeSingle();
      if (error) return { ok: false, error: memberErrorFromDatabase(error) };
      const row = data as { state: unknown; workspace_id: string | null } | null;
      return { ok: true, value: { state: row?.state, workspaceId: row?.workspace_id ?? null } };
    },
  };
}

type MembersRole = MemberSummary["role"];

/** Request-scoped members service acting as the signed-in user. */
export async function getMembersService() {
  const supabase = await getSupabase();
  return createMembersService(supabaseIdentity(supabase), createSupabaseMembersRepository(supabase), { generate: generateInvitationToken, hash: hashInvitationToken });
}

export type TeamRead<T> = { ok: true; value: T } | { ok: false; error: MemberErrorKind };

/** Members of a workspace the caller belongs to (the page has already authorized `members.view`). */
export async function fetchWorkspaceMembers(workspaceId: string): Promise<TeamRead<MemberSummary[]>> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("list_workspace_members", { p_workspace_id: workspaceId });
  if (error) return { ok: false, error: memberErrorFromDatabase(error) };
  const rows = data as { membership_id: string; user_id: string; role: MembersRole; display_name: string | null; email: string | null; joined_at: string; is_self: boolean }[];
  return { ok: true, value: rows.map((row) => ({ membershipId: row.membership_id, userId: row.user_id, role: row.role, displayName: row.display_name, email: row.email, joinedAt: row.joined_at, isSelf: row.is_self })) };
}

/** Invitations of the workspace, newest first. RLS returns rows to owners and admins only. */
export async function fetchWorkspaceInvitations(workspaceId: string): Promise<TeamRead<InvitationSummary[]>> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workspace_invitations")
    .select("id, email, role, created_at, expires_at, revoked_at, accepted_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(INVITATION_LIST_LIMIT);
  if (error) return { ok: false, error: memberErrorFromDatabase(error) };
  const invitations: InvitationSummary[] = [];
  for (const row of data) {
    const role = parseInvitableRole(row.role);
    if (role) invitations.push({ id: row.id, email: row.email, role, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at, acceptedAt: row.accepted_at });
  }
  return { ok: true, value: invitations };
}
