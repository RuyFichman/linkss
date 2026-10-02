import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { AnalyticsErrorKind, AnalyticsRepository } from "./service";

// PostgREST: the function is not in the schema cache, that is, the migration is not applied yet.
const FUNCTION_MISSING = new Set(["PGRST202", "42883"]);

function analyticsError(error: { code?: string | null }): AnalyticsErrorKind {
  switch (error.code) {
    case "42501": return "forbidden";
    case "P0002":
    case "PGRST116": return "not_found";
    default: return "unavailable";
  }
}

/** Runs as the signed-in user: the RPCs re-check membership, and profiles are limited by RLS. */
export function createSupabaseAnalyticsRepository(supabase: SupabaseServerClient): AnalyticsRepository {
  return {
    async findProfile(profileId) {
      const { data, error } = await supabase.from("profiles").select("id, workspace_id").eq("id", profileId).maybeSingle();
      if (error) throw new Error(`Analytics profile lookup failed: ${error.code}`);
      return data ? { id: data.id, workspaceId: data.workspace_id } : null;
    },

    async readReport(profileId, from, to) {
      const { data, error } = await supabase.rpc("get_profile_analytics", { p_profile_id: profileId, p_from: from, p_to: to });
      if (!error) return { kind: "report", data };
      if (error.code && FUNCTION_MISSING.has(error.code)) return { kind: "not_deployed" };
      return { kind: "error", error: analyticsError(error) };
    },

    async recordExport(profileId, from, to, rows) {
      const { error } = await supabase.rpc("record_analytics_export", { p_profile_id: profileId, p_from: from, p_to: to, p_rows: rows });
      return error ? { ok: false, error: analyticsError(error) } : { ok: true };
    },
  };
}
