"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { supabasePublicConfig } from "./config";

/**
 * Browser client with the publishable key only. Sprint 2 performs every Supabase call on the
 * server; this exists for later client-side features (e.g. realtime editor state).
 */
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = supabasePublicConfig();
  return createBrowserClient<Database>(url, publishableKey);
}
