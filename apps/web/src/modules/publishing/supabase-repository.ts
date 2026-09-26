import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { publishingErrorFromDatabase, type PublishingRepository } from "./service";

/** Runs as the signed-in user: reads are filtered by RLS and every write is a checked RPC. */
export function createSupabasePublishingRepository(supabase: SupabaseServerClient): PublishingRepository {
  return {
    async findTarget(profileId) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, workspace_id, slug, draft_revision, live_publication_id, published_at")
        .eq("id", profileId)
        .maybeSingle();
      if (error) throw new Error(`Publish target lookup failed: ${error.code}`);
      return data
        ? { id: data.id, workspaceId: data.workspace_id, slug: data.slug, draftRevision: data.draft_revision, livePublicationId: data.live_publication_id, publishedAt: data.published_at }
        : null;
    },

    async listPublications(profileId, limit) {
      const { data, error } = await supabase
        .from("profile_publications")
        .select("id, version, source_revision, created_at")
        .eq("profile_id", profileId)
        .order("version", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`Publication listing failed: ${error.code}`);
      return data.map((row) => ({ id: row.id, version: row.version, sourceRevision: row.source_revision, createdAt: row.created_at }));
    },

    async publish(profileId, expectedRevision) {
      const { data, error } = await supabase
        .rpc("publish_profile", expectedRevision === null ? { p_profile_id: profileId } : { p_profile_id: profileId, p_expected_revision: expectedRevision })
        .single();
      if (error) return { ok: false, error: publishingErrorFromDatabase(error) };
      return { ok: true, value: { publicationId: data.publication_id, version: data.version, created: data.created } };
    },

    async restore(profileId, publicationId) {
      const { data, error } = await supabase.rpc("restore_profile_publication", { p_profile_id: profileId, p_publication_id: publicationId });
      return error ? { ok: false, error: publishingErrorFromDatabase(error) } : { ok: true, value: data };
    },

    async unpublish(profileId) {
      const { error } = await supabase.rpc("unpublish_profile", { p_profile_id: profileId });
      return error ? { ok: false, error: publishingErrorFromDatabase(error) } : { ok: true, value: null };
    },
  };
}
