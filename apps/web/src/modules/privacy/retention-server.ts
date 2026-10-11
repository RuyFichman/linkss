import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { parseRetentionReport, type RetentionReport } from "./retention";

export type RetentionResult = { kind: "done"; report: RetentionReport } | { kind: "not_configured" } | { kind: "not_deployed" };

/**
 * Retention job wiring (ADR 0018). An administrative job with no signed-in user: like the other
 * jobs it uses the secret key, and the function it calls is granted to the service role only.
 * Throws when the database call fails.
 */
export async function runConfiguredRetention(): Promise<RetentionResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return { kind: "not_configured" };
  const client = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("run_retention_maintenance", {});
  if (error) {
    if (isMissingSchemaError(error)) return { kind: "not_deployed" };
    throw new Error(`Retention maintenance failed: ${error.code}`);
  }
  return { kind: "done", report: parseRetentionReport(data) };
}
