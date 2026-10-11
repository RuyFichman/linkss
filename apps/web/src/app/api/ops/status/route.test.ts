import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateOps, JOBS, opsPasses, parseOpsSnapshot, type OpsSnapshot } from "@/modules/ops/status";

const { readOpsSnapshot } = vi.hoisted(() => ({ readOpsSnapshot: vi.fn() }));
vi.mock("@/modules/ops/status-server", () => ({ readOpsSnapshot }));

const { GET } = await import("./route");

const SECRET = "o".repeat(64);
const NOW = "2026-10-11T12:00:00.000Z";
const hoursAgo = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();

function snapshot(overrides: Partial<OpsSnapshot> = {}): OpsSnapshot {
  return {
    now: NOW,
    jobs: JOBS.map((job) => ({ job, lastRunAt: hoursAgo(5), lastOkAt: hoursAgo(5), lastOutcome: "ok" })),
    billing: { stuckProcessing: 0, mismatches24h: 0 },
    queues: { reportsWaiting: 0, appealsWaiting: 0, privacyWaiting: 0 },
    purge: { profilesOverdue: 0, workspacesOverdue: 0 },
    ...overrides,
  };
}

const billingOff = { billing: { asked: "off", mode: "off" as const, reason: "disabled" } };
const failing = (checks: ReturnType<typeof evaluateOps>) => checks.filter((check) => !check.ok).map((check) => check.name);

describe("operational checks", () => {
  it("passes when every job ran, billing is consistent and nothing waits", () => {
    const checks = evaluateOps(snapshot(), billingOff);
    expect(failing(checks)).toEqual([]);
    expect(opsPasses(checks, true)).toBe(true);
    expect(checks.every((check) => check.runbook.startsWith("docs/runbooks/"))).toBe(true);
  });

  it("fails a job with no good run for more than a day and a half, and one that never ran", () => {
    const jobs = snapshot().jobs.map((job) => job.job === "billing" ? { ...job, lastOkAt: hoursAgo(37), lastOutcome: "unavailable" } : job.job === "retention" ? { ...job, lastOkAt: null } : job);
    const checks = evaluateOps(snapshot({ jobs: jobs.filter((job) => job.job !== "analytics") }), billingOff);
    expect(failing(checks)).toEqual(["job:analytics", "job:billing", "job:retention"]);
    expect(opsPasses(checks, false)).toBe(false);
    expect(evaluateOps(snapshot({ jobs: snapshot().jobs.map((job) => ({ ...job, lastOkAt: hoursAgo(36) })) }), billingOff).every((check) => check.ok)).toBe(true);
  });

  it("fails when billing was asked for and resolved to off, with the reason", () => {
    const checks = evaluateOps(snapshot(), { billing: { asked: "sandbox", mode: "off", reason: "key_mode_mismatch" } });
    expect(failing(checks)).toEqual(["billing:mode"]);
    expect(checks.find((check) => check.name === "billing:mode")?.detail).toContain("key_mode_mismatch");
    expect(failing(evaluateOps(snapshot(), { billing: { asked: "live", mode: "live", reason: "ok" } }))).toEqual([]);
  });

  it("fails on stuck or mismatched billing events", () => {
    expect(failing(evaluateOps(snapshot({ billing: { stuckProcessing: 1, mismatches24h: 2 } }), billingOff))).toEqual(["billing:stuck_events", "billing:mismatches"]);
  });

  it("counts work waiting for a person only when attention is asked for", () => {
    const checks = evaluateOps(snapshot({ queues: { reportsWaiting: 1, appealsWaiting: 2, privacyWaiting: 1 }, purge: { profilesOverdue: 1, workspacesOverdue: 0 } }), billingOff);
    expect(failing(checks)).toEqual(["retention:backlog", "queue:moderation_reports", "queue:moderation_appeals", "queue:privacy_requests"]);
    expect(opsPasses(checks, false)).toBe(true);
    expect(opsPasses(checks, true)).toBe(false);
  });

  it("reads the database answer and refuses a malformed one", () => {
    expect(parseOpsSnapshot({ now: NOW, jobs: [{ job: "billing", lastOkAt: NOW, lastRunAt: NOW, lastOutcome: "ok" }], billing: { stuckProcessing: "3" }, queues: { reportsWaiting: 2.7 } }))
      .toEqual({ now: NOW, jobs: [{ job: "billing", lastOkAt: NOW, lastRunAt: NOW, lastOutcome: "ok" }], billing: { stuckProcessing: 0, mismatches24h: 0 }, queues: { reportsWaiting: 2, appealsWaiting: 0, privacyWaiting: 0 }, purge: { profilesOverdue: 0, workspacesOverdue: 0 } });
    for (const value of [null, {}, { now: "yesterday", jobs: [] }, { now: NOW }]) expect(parseOpsSnapshot(value)).toBeNull();
  });
});

describe("status route", () => {
  beforeEach(() => {
    vi.stubEnv("OPS_STATUS_SECRET", SECRET);
    vi.stubEnv("BILLING_MODE", "off");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    readOpsSnapshot.mockReset().mockResolvedValue({ kind: "ok", snapshot: snapshot() });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const call = (authorization?: string, query = "") => GET(new Request(`https://exemplo.test/api/ops/status${query}`, { headers: authorization ? { authorization } : {} }));

  it("answers 200 with the checks when everything passes", async () => {
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, failing: [], checkedAt: NOW });
    expect(body.checks).toHaveLength(12);
  });

  it("refuses a call without the secret, with a wrong one, or with the job secret, and reads nothing", async () => {
    vi.stubEnv("CRON_SECRET", "c".repeat(64));
    for (const authorization of [undefined, `Bearer ${"x".repeat(64)}`, SECRET, `Bearer ${"c".repeat(64)}`]) expect((await call(authorization)).status).toBe(401);
    expect(readOpsSnapshot).not.toHaveBeenCalled();
  });

  it("answers 503 when its secret is missing or short", async () => {
    vi.stubEnv("OPS_STATUS_SECRET", "short");
    const response = await call("Bearer short");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "not_configured" });
  });

  it("answers 503 when the database cannot be read, which is itself the alert", async () => {
    for (const kind of ["unavailable", "not_deployed", "not_configured"] as const) {
      readOpsSnapshot.mockResolvedValueOnce({ kind });
      const response = await call(`Bearer ${SECRET}`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: kind });
    }
  });

  it("answers 503 for a critical failure, and for waiting work only when asked", async () => {
    readOpsSnapshot.mockResolvedValue({ kind: "ok", snapshot: snapshot({ queues: { reportsWaiting: 1, appealsWaiting: 0, privacyWaiting: 0 } }) });
    expect((await call(`Bearer ${SECRET}`)).status).toBe(200);
    const daily = await call(`Bearer ${SECRET}`, "?attention=1");
    expect(daily.status).toBe(503);
    expect((await daily.json()).failing).toEqual(["queue:moderation_reports"]);
    readOpsSnapshot.mockResolvedValue({ kind: "ok", snapshot: snapshot({ billing: { stuckProcessing: 2, mismatches24h: 0 } }) });
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  });

  it("never puts an address, a secret or the provider key in the body", async () => {
    vi.stubEnv("BILLING_MODE", "sandbox");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_" + "a".repeat(30));
    const text = await (await call(`Bearer ${SECRET}`)).text();
    expect(text).not.toContain("sk_live_");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("@");
  });
});
