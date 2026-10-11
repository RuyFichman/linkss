/**
 * Report of the daily retention job (ADR 0018). The counts come from
 * `public.run_retention_maintenance`; a field the database did not send counts as zero, so an
 * application one version ahead of the database still reads the answer.
 */
export const RETENTION_COUNTERS = [
  "leads", "leadHits", "invitations", "reportLinks", "reportFailures", "moderationReports",
  "privacyRequests", "auditEvents", "slugHistory", "profiles", "workspaces",
] as const;

export type RetentionCounter = (typeof RETENTION_COUNTERS)[number];

export type RetentionReport = Record<RetentionCounter, number> & {
  /** Deleted pages and workspaces past their date that could not be removed in this run (image files or a subscription still there). */
  pendingProfiles: number;
  pendingWorkspaces: number;
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function parseRetentionReport(data: unknown): RetentionReport {
  const row = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  const counters = Object.fromEntries(RETENTION_COUNTERS.map((name) => [name, count(row[name])])) as Record<RetentionCounter, number>;
  return { ...counters, pendingProfiles: count(row.pendingProfiles), pendingWorkspaces: count(row.pendingWorkspaces) };
}

/** Rows removed in the run, for the log line. */
export function retentionTotal(report: RetentionReport): number {
  return RETENTION_COUNTERS.reduce((sum, name) => sum + report[name], 0);
}
