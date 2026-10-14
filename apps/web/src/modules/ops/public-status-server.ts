import "server-only";
import { logEvent } from "@/lib/observability/logger";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { publicStatus, type PublicStatus } from "./public-status";

/** How long one probe answers for, per server instance. */
export const STATUS_FRESH_FOR_MS = 30_000;

let last: { at: number; status: PublicStatus } | null = null;

/**
 * One anonymous read, the same every public page makes (publishable key, no cookie, four-second
 * timeout), for an address that is reserved and therefore never a page. The answer is kept in
 * memory for thirty seconds, so `/status` costs the database two calls a minute per instance
 * however often it is opened, and what a visitor reads is never older than that. It is not cached
 * by ISR on purpose: a regenerated copy is served stale first, and a status page that answers with
 * the state of an hour ago is worse than none.
 */
export async function probePublicStatus(): Promise<PublicStatus> {
  if (last && Date.now() - last.at < STATUS_FRESH_FOR_MS) return last.status;
  const startedAt = performance.now();
  let databaseOk = false;
  try {
    const { error } = await createPublicSupabaseClient().rpc("get_public_page", { p_slug: "status" }).maybeSingle();
    databaseOk = !error;
  } catch {
    databaseOk = false;
  }
  const databaseMs = Math.round(performance.now() - startedAt);
  const status = publicStatus({ databaseOk, databaseMs }, new Date());
  if (status.overall !== "operational") logEvent("warn", "status.degraded", { databaseOk, durationMs: databaseMs });
  last = { at: Date.now(), status };
  return status;
}
