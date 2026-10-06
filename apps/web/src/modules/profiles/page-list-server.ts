import "server-only";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/modules/identity/guard";
import { getSupabase } from "@/modules/identity/session";
import { isMediaId } from "@/modules/media/policy";
import { PAGE_LIST_SIZE, pageListOffset, readPageListRow, type PageListItem, type PageListParams, type PageListResult } from "./page-list";

// Only used by the fallback below; no plan allows more than a few dozen pages.
const FALLBACK_LIMIT = 200;

/**
 * Everything the page list shows, in one query whatever the number of pages (ADR 0012). Runs as
 * the signed-in user: RLS keeps other workspaces out. Before the Sprint 7 migration is applied the
 * function does not exist, and the list falls back to the plain Sprint 2 query without search.
 */
export async function fetchPageList(supabase: SupabaseServerClient, workspaceId: string, params: PageListParams): Promise<PageListResult> {
  const { data, error } = await supabase
    .rpc("list_workspace_profiles", {
      p_workspace_id: workspaceId,
      p_search: params.search,
      p_slug_search: params.slugSearch,
      ...(params.status ? { p_status: params.status } : {}),
      p_order: params.order,
      p_limit: PAGE_LIST_SIZE,
      p_offset: pageListOffset(params),
    })
    .maybeSingle();
  if (!error) {
    const result = readPageListRow(data);
    return { ...result, items: result.items.map((item) => ({ ...item, avatarPath: isMediaId(item.avatarPath) ? item.avatarPath : null })) };
  }
  if (!isMissingSchemaError(error)) throw new Error(`Page list failed: ${error.code}`);

  const fallback = await supabase
    .from("profiles")
    .select("id, title, slug, status, avatar_path, published_at, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(FALLBACK_LIMIT);
  if (fallback.error) throw new Error(`Page list failed: ${fallback.error.code}`);
  const items: PageListItem[] = fallback.data.map((row) => ({
    id: row.id, title: row.title, slug: row.slug, status: row.status, avatarPath: isMediaId(row.avatar_path) ? row.avatar_path : null,
    publishedAt: row.published_at, createdAt: row.created_at, updatedAt: row.updated_at, hasUnpublishedChanges: false,
  }));
  const counts = { draft: 0, published: 0, archived: 0 };
  for (const item of items) counts[item.status] += 1;
  return { total: items.length, counts, matched: items.length, items, searchable: false };
}

/** Addresses already used in the workspace, to suggest a free one for a copy. Bounded. */
export async function fetchWorkspaceSlugs(workspaceId: string): Promise<string[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("profiles").select("slug").eq("workspace_id", workspaceId).limit(FALLBACK_LIMIT);
  if (error) throw new Error(`Slug listing failed: ${error.code}`);
  return data.map((row) => row.slug);
}

/**
 * The page this one was copied from, or null. Read apart from the main page query so that the
 * editor keeps working while the column does not exist yet.
 */
export async function fetchDuplicatedFrom(profileId: string): Promise<string | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("profiles").select("duplicated_from").eq("id", profileId).maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return null;
    throw new Error(`Page origin lookup failed: ${error.code}`);
  }
  return isUuid(data?.duplicated_from) ? data.duplicated_from : null;
}
