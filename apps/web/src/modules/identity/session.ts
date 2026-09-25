import "server-only";
import { cache } from "react";
import { logEvent } from "@/lib/observability/logger";
import { createSupabaseServerClient, type SupabaseServerClient } from "@/lib/supabase/server";
import type { IdentityPort } from "./guard";
import type { WorkspaceKind, WorkspaceRole } from "./permissions";

/** One Supabase client per request. */
export const getSupabase = cache(createSupabaseServerClient);

/** Verified user id from the JWT (getClaims), never from the unverified session cookie. */
export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error) return null;
  const sub = data?.claims?.sub;
  return typeof sub === "string" ? sub : null;
});

export function supabaseIdentity(supabase: SupabaseServerClient): IdentityPort {
  return {
    currentUserId: getCurrentUserId,
    async roleIn(userId, workspaceId) {
      const { data, error } = await supabase
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw new Error(`Membership lookup failed: ${error.code}`);
      return data?.role ?? null;
    },
  };
}

export interface WorkspaceMembership {
  workspaceId: string;
  name: string;
  kind: WorkspaceKind;
  status: "active" | "suspended";
  planId: string;
  role: WorkspaceRole;
}

/** Active memberships in live workspaces (RLS hides everything else). Personal first. */
export async function fetchMyWorkspaces(userId: string): Promise<WorkspaceMembership[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("role, workspaces!inner(id, name, kind, status, plan_id)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Workspace listing failed: ${error.code}`);
  return data
    .map(({ role, workspaces }) => ({ workspaceId: workspaces.id, name: workspaces.name, kind: workspaces.kind, status: workspaces.status, planId: workspaces.plan_id, role }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "pt-BR") : a.kind === "personal" ? -1 : 1));
}

export type AccountResolution =
  | { status: "anonymous" }
  | { status: "ready"; userId: string; workspaces: WorkspaceMembership[]; personal: WorkspaceMembership }
  | { status: "provisioning-failed"; userId: string };

/**
 * Resolves the signed-in person and their workspaces once per request (layouts and pages render
 * in parallel and share this result). Provisions the personal workspace if it is missing.
 */
export const resolveAccount = cache(async (): Promise<AccountResolution> => {
  const userId = await getCurrentUserId();
  if (!userId) return { status: "anonymous" };
  let workspaces = await fetchMyWorkspaces(userId);
  let personal = workspaces.find((workspace) => workspace.kind === "personal");
  if (!personal) {
    const ensured = await ensurePersonalWorkspace(await getSupabase());
    if (!ensured) {
      logEvent("error", "identity.personal_workspace_failed", { stage: "layout" });
      return { status: "provisioning-failed", userId };
    }
    workspaces = await fetchMyWorkspaces(userId);
    personal = workspaces.find((workspace) => workspace.kind === "personal");
    if (!personal) return { status: "provisioning-failed", userId };
  }
  return { status: "ready", userId, workspaces, personal };
});

/** Idempotent; see ensure_personal_workspace() in ADR 0004. */
export async function ensurePersonalWorkspace(supabase: SupabaseServerClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("ensure_personal_workspace");
  if (error) return null;
  return data;
}
