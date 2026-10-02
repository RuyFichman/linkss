import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { supabasePublicConfig } from "@/lib/supabase/config";
import { parseIngestOutcome, type IngestRepository } from "./ingest";

/** A batch is not worth more than this: past it the write is abandoned and the batch is lost. */
export const INGEST_TIMEOUT_MS = 2000;

// PostgREST: the function is not in the schema cache, that is, the migration is not applied yet.
const FUNCTION_MISSING = new Set(["PGRST202", "42883"]);

/**
 * Visitor side of the write path. Acts as `anon` (publishable key, no cookies, no secret key): the
 * only thing it can do is call the attested RPC.
 */
export function createSupabaseIngestRepository(): IngestRepository {
  const { url, publishableKey } = supabasePublicConfig();
  const supabase = createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(INGEST_TIMEOUT_MS) }) },
  });
  return {
    async ingest(payload, signature) {
      const { data, error } = await supabase.rpc("ingest_analytics_events", { p_payload: payload, p_signature: signature });
      if (error) {
        if (FUNCTION_MISSING.has(error.code)) return { status: "not_deployed", accepted: 0, duplicate: 0, repeat: 0, rejected: 0, rateLimited: 0 };
        throw new Error(`Analytics ingestion failed: ${error.code}`);
      }
      return parseIngestOutcome(data);
    },
  };
}
