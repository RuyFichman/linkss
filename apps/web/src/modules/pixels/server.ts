import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { getSupabase, supabaseIdentity } from "@/modules/identity/session";
import { createPixelsService, pixelsErrorFromDatabase, type PixelsRepository } from "./service";

/** Runs as the signed-in user: the read is filtered by RLS and the write is a checked RPC. */
export function createSupabasePixelsRepository(supabase: SupabaseServerClient): PixelsRepository {
  return {
    async findProfileWorkspace(profileId) {
      const { data, error } = await supabase.from("profiles").select("workspace_id").eq("id", profileId).maybeSingle();
      if (error) throw new Error(`Pixels page lookup failed: ${error.code}`);
      return data?.workspace_id ?? null;
    },

    async find(profileId) {
      const { data, error } = await supabase.from("profile_pixels").select("meta_pixel_id, ga_measurement_id").eq("profile_id", profileId).maybeSingle();
      if (error) return { ok: false, ...pixelsErrorFromDatabase(error) };
      return { ok: true, value: { metaPixelId: data?.meta_pixel_id ?? null, gaMeasurementId: data?.ga_measurement_id ?? null } };
    },

    async set(profileId, input) {
      const { data, error } = await supabase
        .rpc("set_profile_pixels", { p_profile_id: profileId, p_meta_pixel_id: input.metaPixelId ?? "", p_ga_measurement_id: input.gaMeasurementId ?? "" })
        .single();
      return error ? { ok: false, ...pixelsErrorFromDatabase(error) } : { ok: true, value: { slug: data.slug, isLive: data.is_live } };
    },
  };
}

/** Request-scoped pixels service acting as the signed-in user. */
export async function getPixelsService() {
  const supabase = await getSupabase();
  return createPixelsService(supabaseIdentity(supabase), createSupabasePixelsRepository(supabase));
}
