import "server-only";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { getSupabase, supabaseIdentity } from "@/modules/identity/session";
import { isReportToken, reportLinkErrorFromDatabase } from "./links";
import { createReportLinksService, type ReportLinksRepository } from "./service";
import { parseSharedReport, type SharedReport } from "./shared-report";
import { generateReportToken, hashReportToken } from "./token";

// A page may hold 5 active links; finished ones are kept for 90 days. Bounded anyway.
const LINK_LIST_LIMIT = 50;

/** Runs as the signed-in user: reads are filtered by RLS and every write is a checked RPC. */
export function createSupabaseReportLinksRepository(supabase: SupabaseServerClient): ReportLinksRepository {
  return {
    async findProfileWorkspace(profileId) {
      const { data, error } = await supabase.from("profiles").select("workspace_id").eq("id", profileId).maybeSingle();
      if (error) throw new Error(`Report page lookup failed: ${error.code}`);
      return data?.workspace_id ?? null;
    },

    async findLinkWorkspace(linkId) {
      const { data, error } = await supabase.from("report_links").select("workspace_id").eq("id", linkId).maybeSingle();
      // Before the migration, or for a row RLS hides, the answer is the same: there is no such link.
      return error ? null : data?.workspace_id ?? null;
    },

    async createLink(input) {
      const { data, error } = await supabase
        .rpc("create_report_link", {
          p_profile_id: input.profileId, p_token_hash: input.tokenHash, p_period_days: input.periodDays, p_expires_in_days: input.expiresInDays,
          ...(input.label === null ? {} : { p_label: input.label }),
        })
        .single();
      return error ? { ok: false, error: reportLinkErrorFromDatabase(error) } : { ok: true, value: { id: data.link_id, expiresAt: data.expires_at } };
    },

    async revokeLink(linkId) {
      const { error } = await supabase.rpc("revoke_report_link", { p_link_id: linkId });
      return error ? { ok: false, error: reportLinkErrorFromDatabase(error) } : { ok: true, value: null };
    },

    async listLinks(profileId) {
      const { data, error } = await supabase
        .from("report_links")
        .select("id, profile_id, period_days, label, created_at, expires_at, revoked_at")
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false })
        .limit(LINK_LIST_LIMIT);
      if (error) return { ok: false, error: reportLinkErrorFromDatabase(error) };
      return {
        ok: true,
        value: data.map((row) => ({ id: row.id, profileId: row.profile_id, periodDays: row.period_days, label: row.label, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at })),
      };
    },
  };
}

/** Request-scoped report-link service acting as the signed-in user. */
export async function getReportLinksService() {
  const supabase = await getSupabase();
  return createReportLinksService(supabaseIdentity(supabase), createSupabaseReportLinksRepository(supabase), { generate: generateReportToken, hash: hashReportToken });
}

export type SharedReportRead =
  | { kind: "report"; report: SharedReport }
  /** One outcome for every token that does not open a report. */
  | { kind: "unavailable" }
  /** The database could not be asked (down, timeout, or the migration is not applied). */
  | { kind: "error"; code: string };

/**
 * The anonymous read behind /r/<token>: publishable key, no session, no cookies, no service key.
 * A token that is not even well formed never reaches the database.
 */
export async function fetchSharedReport(token: unknown, clientHash: string | null): Promise<SharedReportRead> {
  if (!isReportToken(token)) return { kind: "unavailable" };
  try {
    const { data, error } = await createPublicSupabaseClient().rpc("get_shared_report", { p_token: token, ...(clientHash ? { p_client: clientHash } : {}) });
    if (error) return { kind: "error", code: error.code || "unknown" };
    const report = parseSharedReport(data);
    return report ? { kind: "report", report } : { kind: "unavailable" };
  } catch {
    return { kind: "error", code: "network" };
  }
}
