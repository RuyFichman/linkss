import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { AuthorizationError, requireWorkspaceAccess, type WorkspaceAccess } from "./guard";
import type { WorkspaceAction } from "./permissions";
import { getSupabase, supabaseIdentity } from "./session";

/**
 * Page-level use of the authorization guard. Unauthenticated → sign-in; not a member or unknown id
 * → 404 (never "forbidden", so other tenants' ids are not confirmed). Returns null when the member
 * lacks this capability, letting the page explain instead of hiding the whole workspace.
 */
export const authorizeWorkspacePage = cache(async (workspaceId: string, action: WorkspaceAction): Promise<WorkspaceAccess | null> => {
  const supabase = await getSupabase();
  try {
    return await requireWorkspaceAccess(supabaseIdentity(supabase), workspaceId, action);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (error.reason === "unauthenticated") redirect("/entrar");
    if (error.reason === "not_found") notFound();
    return null;
  }
});
