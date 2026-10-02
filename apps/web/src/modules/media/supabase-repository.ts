import "server-only";
import type { Json } from "@/lib/database.types";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { MediaRepository, MediaRepositoryError } from "./service";

/** Maps the SQLSTATE contract of the media RPCs (ADR 0009) to domain errors. */
export function mediaErrorFromDatabase(error: { code?: string | null; details?: string | null }): MediaRepositoryError {
  switch (error.code) {
    case "LK010": return "quota";
    case "LK061": return "rate_limited";
    case "LK060":
    case "LK062": return "attestation";
    case "LK090": return "not_configured";
    case "42501": return "forbidden";
    case "P0002":
    case "PGRST116": return "not_found";
    default: return "unavailable";
  }
}

/** Runs as the signed-in user: RLS filters the reads and every write is a checked RPC. */
export function createSupabaseMediaRepository(supabase: SupabaseServerClient): MediaRepository {
  return {
    async findProfile(profileId) {
      const { data, error } = await supabase.from("profiles").select("id, workspace_id").eq("id", profileId).maybeSingle();
      if (error) throw new Error(`Media profile lookup failed: ${error.code}`);
      return data ? { id: data.id, workspaceId: data.workspace_id } : null;
    },

    async register(input) {
      // The database stores variants as {w, h, bytes}; the signature covers the same values.
      const variants = input.variants.map((variant) => ({ w: variant.width, h: variant.height, bytes: variant.bytes })) as unknown as Json;
      const { error } = await supabase.rpc("register_media_asset", {
        p_media_id: input.mediaId, p_profile_id: input.profileId, p_kind: input.kind, p_width: input.width, p_height: input.height, p_variants: variants, p_signature: input.signature,
      });
      return error ? { ok: false, error: mediaErrorFromDatabase(error) } : { ok: true };
    },

    async activate(mediaId, signature) {
      const { error } = await supabase.rpc("activate_media_asset", { p_media_id: mediaId, p_signature: signature });
      return error ? { ok: false, error: mediaErrorFromDatabase(error) } : { ok: true };
    },

    async fail(mediaId) {
      await supabase.rpc("fail_media_asset", { p_media_id: mediaId });
    },

    async usage(workspaceId) {
      const { data, error } = await supabase.rpc("workspace_storage_usage", { p_workspace_id: workspaceId }).single();
      if (error) throw new Error(`Storage usage lookup failed: ${error.code}`);
      return { usedBytes: data.used_bytes, limitBytes: data.limit_bytes };
    },
  };
}
