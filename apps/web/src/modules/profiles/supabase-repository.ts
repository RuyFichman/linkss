import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { resolveEntitlements } from "@/modules/entitlements";
import type { Json } from "@/lib/database.types";
import { readDraftBlocks } from "@/modules/blocks";
import { isMediaId } from "@/modules/media/policy";
import { readTheme } from "@/modules/themes/tokens";
import { profileErrorFromDatabase } from "./errors";
import type { ProfileRepository, ProfileSummary } from "./service";

const PROFILE_COLUMNS = "id, workspace_id, title, bio, slug, status, avatar_path, theme, blocks, draft_revision, live_publication_id, published_at, created_at, updated_at";
// Bounded even though Free/Pro/Agency allow at most 10 live pages per workspace.
const PROFILE_LIST_LIMIT = 200;

interface ProfileRow {
  id: string;
  workspace_id: string;
  title: string;
  bio: string;
  slug: string;
  status: ProfileSummary["status"];
  avatar_path: string | null;
  theme: Json | null;
  blocks: Json;
  draft_revision: number;
  live_publication_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

function toSummary(row: ProfileRow): ProfileSummary {
  return {
    id: row.id, workspaceId: row.workspace_id, title: row.title, bio: row.bio, slug: row.slug, status: row.status,
    // Tolerant reads: anything that is not a media id or a valid theme shows the initials / the classic look.
    avatarPath: isMediaId(row.avatar_path) ? row.avatar_path : null, theme: readTheme(row.theme),
    blocks: readDraftBlocks(row.blocks), draftRevision: row.draft_revision,
    livePublicationId: row.live_publication_id, publishedAt: row.published_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** Runs as the signed-in user: every read and write below is also constrained by RLS. */
export function createSupabaseProfileRepository(supabase: SupabaseServerClient): ProfileRepository {
  return {
    async findById(profileId) {
      const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", profileId).maybeSingle();
      if (error) throw new Error(`Profile lookup failed: ${error.code}`);
      return data ? toSummary(data) : null;
    },

    async listByWorkspace(workspaceId) {
      const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(PROFILE_LIST_LIMIT);
      if (error) throw new Error(`Profile listing failed: ${error.code}`);
      return data.map(toSummary);
    },

    async countLive(workspaceId) {
      const { count, error } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      if (error) throw new Error(`Profile count failed: ${error.code}`);
      return count ?? 0;
    },

    async entitlements(workspaceId) {
      const { data: workspace, error } = await supabase.from("workspaces").select("plan_id").eq("id", workspaceId).single();
      if (error) throw new Error(`Workspace plan lookup failed: ${error.code}`);
      const { data: rows, error: rowsError } = await supabase.from("plan_entitlements").select("key, int_value, bool_value").eq("plan_id", workspace.plan_id);
      if (rowsError) throw new Error(`Entitlement lookup failed: ${rowsError.code}`);
      return resolveEntitlements(rows);
    },

    async insert(input) {
      const { data, error } = await supabase
        .from("profiles")
        .insert({ workspace_id: input.workspaceId, title: input.title, bio: input.bio, slug: input.slug })
        .select(PROFILE_COLUMNS)
        .single();
      return error ? { ok: false, error: profileErrorFromDatabase(error) } : { ok: true, value: toSummary(data) };
    },

    async updateDraft(profileId, expectedRevision, draft) {
      // Plain JSON; the database validates blocks, theme and media references again (private.validate_profile_draft).
      const update = { title: draft.title, bio: draft.bio, avatar_path: draft.avatarPath, theme: draft.theme as unknown as Json, blocks: draft.blocks as unknown as Json[] };
      // Optimistic concurrency: one conditional UPDATE, so the write only lands on the revision the
      // person was looking at and title, bio and block order change atomically.
      const { data, error } = await supabase.from("profiles").update(update).eq("id", profileId).eq("draft_revision", expectedRevision).select(PROFILE_COLUMNS).maybeSingle();
      if (error) return { ok: false, error: profileErrorFromDatabase(error) };
      if (data) return { ok: true, value: toSummary(data) };
      // Zero rows: another revision won the race, or RLS filtered the row (lost access, suspension).
      const { data: current, error: currentError } = await supabase.from("profiles").select("draft_revision").eq("id", profileId).maybeSingle();
      if (currentError) return { ok: false, error: "unavailable" };
      return { ok: false, error: current && current.draft_revision !== expectedRevision ? "conflict" : "not_found" };
    },

    async changeSlug(profileId, slug) {
      const { data, error } = await supabase.rpc("change_profile_slug", { p_profile_id: profileId, p_slug: slug });
      return error ? { ok: false, error: profileErrorFromDatabase(error) } : { ok: true, value: data };
    },

    async softDelete(profileId) {
      const { error } = await supabase.rpc("soft_delete_profile", { p_profile_id: profileId });
      return error ? { ok: false, error: profileErrorFromDatabase(error) } : { ok: true, value: null };
    },

    async checkSlug(slug, workspaceId) {
      const { data, error } = await supabase.rpc("check_slug_availability", workspaceId ? { p_slug: slug, p_workspace_id: workspaceId } : { p_slug: slug }).single();
      return error ? { ok: false, error: profileErrorFromDatabase(error) } : { ok: true, value: data };
    },
  };
}
