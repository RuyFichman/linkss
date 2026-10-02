import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { runMediaCleanupBatches, type CleanupReport, type MediaCleanupRepository } from "./cleanup";
import { createSupabaseStorageAdapter } from "./storage/supabase-adapter";

/**
 * Cleanup wiring. This is the one place media code uses the secret key: an administrative job with
 * no signed-in user, as allowed by `.env.example` ("future administrative jobs, never user actions").
 * Returns null when the job is not configured in this environment.
 */
export async function runConfiguredMediaCleanup(): Promise<(CleanupReport & { batches: number }) | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  const client = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const repository: MediaCleanupRepository = {
    async claim(limit) {
      const { data, error } = await client.rpc("claim_media_cleanup", { p_limit: limit });
      if (error) throw new Error(`Media cleanup claim failed: ${error.code}`);
      return data.map((row) => ({ mediaId: row.media_id, objectNames: row.object_names }));
    },
    async finish(mediaIds) {
      const { data, error } = await client.rpc("finish_media_cleanup", { p_media_ids: mediaIds });
      if (error) throw new Error(`Media cleanup finish failed: ${error.code}`);
      return data;
    },
  };
  return runMediaCleanupBatches(repository, createSupabaseStorageAdapter(client));
}
