import { AuthorizationError, requireWorkspaceAccess, type IdentityPort } from "@/modules/identity/guard";
import { DEFAULT_REPORTING_TIME_ZONE, localDay, periodIsAvailable, periodWindow, type PeriodPreset } from "./dates";
import { widestAvailablePeriod, type AnalyticsErrorKind, type AnalyticsResult, type ReportRead } from "./service";
import { pageRows, parseWorkspaceReport, workspaceAnalyticsToCsv, type WorkspaceReport } from "./workspace";

/**
 * Consolidated results of a workspace and their CSV export (ADR 0013). Authorization happens here
 * first (membership re-read per request) and again in the security definer RPCs.
 */
export interface WorkspaceAnalyticsRepository {
  readWorkspaceReport(workspaceId: string, from: string, to: string): Promise<ReportRead>;
  recordWorkspaceExport(workspaceId: string, from: string, to: string, rows: number): Promise<{ ok: true } | { ok: false; error: AnalyticsErrorKind }>;
}

export interface WorkspaceReportView {
  /** The period that was read (the requested one, or the widest one the plan covers). */
  period: PeriodPreset;
  /** Null when the consolidated read is not deployed in this environment. */
  report: WorkspaceReport | null;
}

export function createWorkspaceAnalyticsService(identity: IdentityPort, repository: WorkspaceAnalyticsRepository, dependencies: { now: () => Date } = { now: () => new Date() }) {
  async function authorize(workspaceId: unknown, action: "analytics.view" | "analytics.export"): Promise<AnalyticsResult<string>> {
    try {
      return { ok: true, value: (await requireWorkspaceAccess(identity, workspaceId, action)).workspaceId };
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      return { ok: false, error: error.reason };
    }
  }

  async function read(workspaceId: string, period: PeriodPreset): Promise<AnalyticsResult<WorkspaceReportView>> {
    // The database clamps the window to its own "today" and to the plan; this is only the request.
    const window = periodWindow(period, localDay(dependencies.now(), DEFAULT_REPORTING_TIME_ZONE));
    const result = await repository.readWorkspaceReport(workspaceId, window.from, window.to);
    if (result.kind === "not_deployed") return { ok: true, value: { period, report: null } };
    if (result.kind === "error") return { ok: false, error: result.error };
    const report = parseWorkspaceReport(result.data);
    if (!report) return { ok: false, error: "unavailable" };
    // A period the plan does not cover is never shown clamped under its own name.
    if (!periodIsAvailable(period, report.historyDays)) return read(workspaceId, widestAvailablePeriod(report.historyDays));
    return { ok: true, value: { period, report } };
  }

  return {
    async report(workspaceId: unknown, period: PeriodPreset): Promise<AnalyticsResult<WorkspaceReportView>> {
      const access = await authorize(workspaceId, "analytics.view");
      return access.ok ? read(access.value, period) : access;
    },

    /** CSV of the per-page totals of the period. The export is audited before the file is returned. */
    async exportCsv(workspaceId: unknown, period: PeriodPreset): Promise<AnalyticsResult<{ csv: string; rows: number }>> {
      const access = await authorize(workspaceId, "analytics.export");
      if (!access.ok) return access;
      const view = await read(access.value, period);
      if (!view.ok) return view;
      if (!view.value.report) return { ok: false, error: "unavailable" };
      const { report } = view.value;
      const rows = pageRows(report);
      const recorded = await repository.recordWorkspaceExport(access.value, report.from, report.to, rows.length);
      if (!recorded.ok) return recorded;
      return { ok: true, value: { csv: workspaceAnalyticsToCsv(rows, report), rows: rows.length } };
    },
  };
}
