/**
 * Operational status read by the external monitor (ADR 0019, runbook MONITORING.md).
 *
 * The database returns counts and timestamps (`public.get_ops_status`); this module turns them
 * into checks with a severity. `critical` checks are things that are broken now and fail every
 * run of the monitor; `attention` checks are work waiting for a person and only fail the daily
 * run, so nobody gets an hourly e-mail about a queue. Every check names the runbook to open.
 */
export const JOBS = ["analytics", "billing", "domains", "media-cleanup", "retention"] as const;
export type JobName = (typeof JOBS)[number];

/** The jobs run once a day: a day and a half without a good run means one was missed. */
export const JOB_STALE_AFTER_HOURS = 36;

export type CheckSeverity = "critical" | "attention";

export interface OpsCheck {
  name: string;
  severity: CheckSeverity;
  ok: boolean;
  /** Short and free of personal data: a count, a duration or a reason code. */
  detail: string;
  runbook: string;
}

export interface OpsSnapshot {
  now: string;
  jobs: { job: string; lastRunAt: string | null; lastOkAt: string | null; lastOutcome: string | null }[];
  billing: { stuckProcessing: number; mismatches24h: number };
  queues: { reportsWaiting: number; appealsWaiting: number; privacyWaiting: number };
  purge: { profilesOverdue: number; workspacesOverdue: number };
}

export interface OpsContext {
  /** `BILLING_MODE` as written in the environment, and what it resolved to. */
  billing: { asked: string; mode: "off" | "sandbox" | "live"; reason: string };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

/** Reads the database answer; `null` when it is not the expected shape (treated as unavailable). */
export function parseOpsSnapshot(data: unknown): OpsSnapshot | null {
  const row = record(data);
  const now = text(row.now);
  if (!now || Number.isNaN(Date.parse(now)) || !Array.isArray(row.jobs)) return null;
  const billing = record(row.billing);
  const queues = record(row.queues);
  const purge = record(row.purge);
  return {
    now,
    jobs: row.jobs.map(record).map((job) => ({ job: text(job.job) ?? "", lastRunAt: text(job.lastRunAt), lastOkAt: text(job.lastOkAt), lastOutcome: text(job.lastOutcome) })),
    billing: { stuckProcessing: count(billing.stuckProcessing), mismatches24h: count(billing.mismatches24h) },
    queues: { reportsWaiting: count(queues.reportsWaiting), appealsWaiting: count(queues.appealsWaiting), privacyWaiting: count(queues.privacyWaiting) },
    purge: { profilesOverdue: count(purge.profilesOverdue), workspacesOverdue: count(purge.workspacesOverdue) },
  };
}

const JOB_RUNBOOK: Record<JobName, string> = {
  analytics: "docs/runbooks/JOBS.md",
  billing: "docs/runbooks/JOBS.md",
  domains: "docs/runbooks/JOBS.md",
  "media-cleanup": "docs/runbooks/JOBS.md",
  retention: "docs/runbooks/JOBS.md",
};

export function evaluateOps(snapshot: OpsSnapshot, context: OpsContext): OpsCheck[] {
  const now = Date.parse(snapshot.now);
  const checks: OpsCheck[] = [];

  for (const name of JOBS) {
    const job = snapshot.jobs.find((item) => item.job === name);
    const lastOk = job?.lastOkAt ? Date.parse(job.lastOkAt) : Number.NaN;
    const hours = Number.isNaN(lastOk) ? null : Math.max(0, Math.round((now - lastOk) / 3_600_000));
    checks.push({
      name: `job:${name}`,
      severity: "critical",
      ok: hours !== null && hours <= JOB_STALE_AFTER_HOURS,
      detail: hours === null ? "no successful run recorded" : `last good run ${hours} h ago; last outcome ${job?.lastOutcome ?? "unknown"}`,
      runbook: JOB_RUNBOOK[name],
    });
  }

  // Billing was asked for and resolved to off: checkout is gone and the webhook answers 503.
  const asked = context.billing.asked.trim().toLowerCase();
  const wanted = asked === "sandbox" || asked === "live";
  checks.push({
    name: "billing:mode",
    severity: "critical",
    ok: !wanted || context.billing.mode !== "off",
    detail: wanted ? (context.billing.mode === "off" ? `asked ${asked}, resolved off: ${context.billing.reason}` : `on (${context.billing.mode})`) : "off by configuration",
    runbook: "docs/runbooks/BILLING.md",
  });
  checks.push({ name: "billing:stuck_events", severity: "critical", ok: snapshot.billing.stuckProcessing === 0, detail: `${snapshot.billing.stuckProcessing} event(s) in processing for more than 1 h`, runbook: "docs/runbooks/BILLING.md" });
  checks.push({ name: "billing:mismatches", severity: "critical", ok: snapshot.billing.mismatches24h === 0, detail: `${snapshot.billing.mismatches24h} event(s) with an unknown customer, a mismatch or a conflict in 24 h`, runbook: "docs/runbooks/BILLING.md" });

  const overdue = snapshot.purge.profilesOverdue + snapshot.purge.workspacesOverdue;
  checks.push({ name: "retention:backlog", severity: "attention", ok: overdue === 0, detail: `${snapshot.purge.profilesOverdue} page(s) and ${snapshot.purge.workspacesOverdue} workspace(s) more than 3 days past their purge date`, runbook: "docs/runbooks/RETENTION.md" });
  checks.push({ name: "queue:moderation_reports", severity: "attention", ok: snapshot.queues.reportsWaiting === 0, detail: `${snapshot.queues.reportsWaiting} report(s) not looked at for more than 72 h`, runbook: "docs/runbooks/MODERATION.md" });
  checks.push({ name: "queue:moderation_appeals", severity: "attention", ok: snapshot.queues.appealsWaiting === 0, detail: `${snapshot.queues.appealsWaiting} appeal(s) waiting for more than 72 h`, runbook: "docs/runbooks/MODERATION.md" });
  checks.push({ name: "queue:privacy_requests", severity: "attention", ok: snapshot.queues.privacyWaiting === 0, detail: `${snapshot.queues.privacyWaiting} privacy request(s) open for more than 10 days`, runbook: "docs/runbooks/ACCOUNT_DELETION.md" });
  return checks;
}

/** Whether the monitor run passes: critical checks always count, attention checks only when asked. */
export function opsPasses(checks: OpsCheck[], includeAttention: boolean): boolean {
  return checks.every((check) => check.ok || (check.severity === "attention" && !includeAttention));
}
