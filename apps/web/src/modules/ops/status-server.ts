import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { parseOpsSnapshot, type JobName, type OpsSnapshot } from "./status";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  return createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type OpsSnapshotRead = { kind: "ok"; snapshot: OpsSnapshot } | { kind: "not_configured" } | { kind: "not_deployed" } | { kind: "unavailable" };

/** Administrative read with the secret key (ADR 0019): counts and timestamps, no personal data. */
export async function readOpsSnapshot(): Promise<OpsSnapshotRead> {
  const client = serviceClient();
  if (!client) return { kind: "not_configured" };
  try {
    const { data, error } = await client.rpc("get_ops_status");
    if (error) return { kind: isMissingSchemaError(error) ? "not_deployed" : "unavailable" };
    const snapshot = parseOpsSnapshot(data);
    return snapshot ? { kind: "ok", snapshot } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Heartbeat of a scheduled job, written by its own route after each run. Never throws and never
 * changes the job's answer: a job that worked must not be reported as failed because its
 * heartbeat could not be written (the monitor notices the missing heartbeat instead).
 */
export async function recordJobRun(job: JobName, outcome: string): Promise<void> {
  try {
    await serviceClient()?.rpc("record_job_run", { p_job: job, p_outcome: outcome });
  } catch {
    // Reported by the monitor as a stale job.
  }
}
