import { AuthorizationError, isUuid, requireUser, requireWorkspaceAccess, type IdentityPort } from "@/modules/identity/guard";
import { analyticsToCsv } from "./csv";
import { dailySeries, parseAnalyticsReport, type AnalyticsReport } from "./dashboard";
import { DEFAULT_REPORTING_TIME_ZONE, localDay, periodIsAvailable, periodWindow, PERIOD_PRESETS, type PeriodPreset } from "./dates";

/**
 * Owner side of customer analytics (ADR 0011): the report of one page and its CSV export.
 * Authorization happens here first (membership re-read per request) and again in the security
 * definer RPCs.
 */
export type AnalyticsErrorKind = "forbidden" | "not_found" | "unavailable";
export type AnalyticsResult<T> = { ok: true; value: T } | { ok: false; error: AnalyticsErrorKind | "unauthenticated" };

export type ReportRead =
  | { kind: "report"; data: unknown }
  /** The Sprint 6 migration is not applied in this environment. */
  | { kind: "not_deployed" }
  | { kind: "error"; error: AnalyticsErrorKind };

/** Persistence port. The Supabase implementation runs as the signed-in user. */
export interface AnalyticsRepository {
  findProfile(profileId: string): Promise<{ id: string; workspaceId: string } | null>;
  readReport(profileId: string, from: string, to: string): Promise<ReportRead>;
  recordExport(profileId: string, from: string, to: string, rows: number): Promise<{ ok: true } | { ok: false; error: AnalyticsErrorKind }>;
}

export interface ReportView {
  /** The period that was read (the requested one, or the default when it is not in the plan). */
  period: PeriodPreset;
  /** Null when analytics is not deployed in this environment. */
  report: AnalyticsReport | null;
}

/** The longest preset the plan covers; "today" always is. */
export function widestAvailablePeriod(historyDays: number): PeriodPreset {
  return [...PERIOD_PRESETS].reverse().find((preset) => periodIsAvailable(preset, historyDays)) ?? "today";
}

export function createAnalyticsService(identity: IdentityPort, repository: AnalyticsRepository, dependencies: { now: () => Date } = { now: () => new Date() }) {
  async function authorize(profileId: unknown, action: "analytics.view" | "analytics.export") {
    await requireUser(identity);
    if (!isUuid(profileId)) throw new AuthorizationError("not_found");
    const profile = await repository.findProfile(profileId);
    if (!profile) throw new AuthorizationError("not_found");
    await requireWorkspaceAccess(identity, profile.workspaceId, action);
    return profile;
  }

  function failure<T>(error: unknown): AnalyticsResult<T> {
    if (!(error instanceof AuthorizationError)) throw error;
    return { ok: false, error: error.reason };
  }

  async function read(profileId: string, period: PeriodPreset): Promise<AnalyticsResult<ReportView>> {
    // The database clamps the window to its own "today" and to the plan; this is only the request.
    const window = periodWindow(period, localDay(dependencies.now(), DEFAULT_REPORTING_TIME_ZONE));
    const result = await repository.readReport(profileId, window.from, window.to);
    if (result.kind === "not_deployed") return { ok: true, value: { period, report: null } };
    if (result.kind === "error") return { ok: false, error: result.error };
    const report = parseAnalyticsReport(result.data);
    if (!report) return { ok: false, error: "unavailable" };
    // A period the plan does not cover is never shown clamped under its own name.
    if (!periodIsAvailable(period, report.historyDays)) return read(profileId, widestAvailablePeriod(report.historyDays));
    return { ok: true, value: { period, report } };
  }

  return {
    async report(profileId: unknown, period: PeriodPreset): Promise<AnalyticsResult<ReportView>> {
      let profile;
      try {
        profile = await authorize(profileId, "analytics.view");
      } catch (error) {
        return failure(error);
      }
      return read(profile.id, period);
    },

    /** CSV of the daily totals of the period. The export is audited before the file is returned. */
    async exportCsv(profileId: unknown, period: PeriodPreset): Promise<AnalyticsResult<{ csv: string; rows: number }>> {
      let profile;
      try {
        profile = await authorize(profileId, "analytics.export");
      } catch (error) {
        return failure(error);
      }
      const view = await read(profile.id, period);
      if (!view.ok) return view;
      if (!view.value.report) return { ok: false, error: "unavailable" };
      const { report } = view.value;
      const rows = dailySeries(report);
      const recorded = await repository.recordExport(profile.id, report.from, report.to, rows.length);
      if (!recorded.ok) return recorded;
      return { ok: true, value: { csv: analyticsToCsv(rows, report.timeZone), rows: rows.length } };
    },
  };
}
