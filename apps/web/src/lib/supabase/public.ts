import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { supabasePublicConfig } from "./config";

/**
 * Anonymous client for the public renderer: publishable key, no session, no cookies. Reading
 * cookies would make every public page dynamic; acting as `anon` means the only data it can reach
 * is what public.get_public_page() returns.
 */
// A visitor must never wait on a hung database connection: fail fast, and ISR keeps serving the last
// good copy of pages that were already cached (verified in the Sprint 3 outage test).
export const PUBLIC_LOOKUP_TIMEOUT_MS = 4000;

export function createPublicSupabaseClient() {
  const { url, publishableKey } = supabasePublicConfig();
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(PUBLIC_LOOKUP_TIMEOUT_MS) }) },
  });
}
