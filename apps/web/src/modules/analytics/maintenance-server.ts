import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** Answer of public.run_analytics_maintenance(), reduced to numbers for the log line. */
export interface MaintenanceReport {
  status: "ok" | "out_of_range";
  aggregatedDays: number;
  aggregateRows: number;
  purgedEvents: number;
  purgedAggregateRows: number;
  pendingDays: number;
  lastFinalDay: string | null;
}

export type MaintenanceResult = { kind: "not_configured" } | { kind: "not_deployed" } | { kind: "done"; report: MaintenanceReport };

// PostgREST: the function is not in the schema cache, that is, the migration is not applied yet.
const FUNCTION_MISSING = new Set(["PGRST202", "42883"]);

function integer(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

export function parseMaintenanceReport(value: unknown): MaintenanceReport {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    status: row.status === "out_of_range" ? "out_of_range" : "ok",
    aggregatedDays: integer(row.aggregated_days),
    aggregateRows: integer(row.aggregate_rows),
    purgedEvents: integer(row.purged_events),
    purgedAggregateRows: integer(row.purged_aggregate_rows),
    pendingDays: integer(row.pending_days),
    lastFinalDay: typeof row.last_final_day === "string" ? row.last_final_day : null,
  };
}

/**
 * Job wiring (ADR 0011). Like the media cleanup, this is an administrative job with no signed-in
 * user and the one place analytics code uses the secret key. With `day`, re-aggregates that day
 * only. Throws when the database call fails.
 */
export async function runConfiguredAnalyticsMaintenance(day: string | null): Promise<MaintenanceResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return { kind: "not_configured" };
  const client = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("run_analytics_maintenance", day ? { p_day: day } : {});
  if (error) {
    if (FUNCTION_MISSING.has(error.code)) return { kind: "not_deployed" };
    throw new Error(`Analytics maintenance failed: ${error.code}`);
  }
  return { kind: "done", report: parseMaintenanceReport(data) };
}
