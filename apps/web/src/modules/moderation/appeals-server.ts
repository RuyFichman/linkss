import "server-only";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { getSupabase } from "@/modules/identity/session";
import { parsePageModeration, type PageModeration } from "./appeals";

export interface SuspendedPage {
  id: string;
  title: string;
}

/**
 * Pages of one workspace that moderation took off the air, for the notice every member sees.
 * A plain read under row level security: a member reads the pages of their workspaces and nobody
 * else's. Never throws: the notice must not break the screens it sits on.
 */
export async function suspendedPages(workspaceId: string): Promise<SuspendedPage[]> {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.from("profiles").select("id, title").eq("workspace_id", workspaceId).eq("moderation_status", "suspended").is("deleted_at", null).order("title").limit(20);
    if (error || !data) return [];
    return data.map((row) => ({ id: row.id, title: row.title }));
  } catch {
    return [];
  }
}

export type PageModerationRead = { kind: "ok"; moderation: PageModeration } | { kind: "not_found" } | { kind: "not_deployed" } | { kind: "unavailable" };

export async function readPageModeration(profileId: string): Promise<PageModerationRead> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_page_moderation", { p_profile_id: profileId });
  if (error) {
    if (isMissingSchemaError(error)) return { kind: "not_deployed" };
    if (error.code === "P0002" || error.code === "42501") return { kind: "not_found" };
    return { kind: "unavailable" };
  }
  const moderation = parsePageModeration(data);
  return moderation ? { kind: "ok", moderation } : { kind: "unavailable" };
}
