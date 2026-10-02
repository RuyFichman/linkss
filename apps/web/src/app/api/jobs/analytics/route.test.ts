import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runConfiguredAnalyticsMaintenance } = vi.hoisted(() => ({ runConfiguredAnalyticsMaintenance: vi.fn() }));
vi.mock("@/modules/analytics/maintenance-server", () => ({ runConfiguredAnalyticsMaintenance }));

const { GET, POST } = await import("./route");

const SECRET = "c".repeat(64);
const report = { status: "ok", aggregatedDays: 2, aggregateRows: 14, purgedEvents: 120, purgedAggregateRows: 0, pendingDays: 0, lastFinalDay: "2026-10-01" };

function call(method: typeof GET, authorization?: string, query = "") {
  const headers = new Headers(authorization ? { authorization } : {});
  return method(new Request(`https://exemplo.test/api/jobs/analytics${query}`, { method: method === GET ? "GET" : "POST", headers }));
}

describe("analytics job route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    runConfiguredAnalyticsMaintenance.mockReset().mockResolvedValue({ kind: "done", report });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // Vercel Cron calls with GET and `Authorization: Bearer <CRON_SECRET>`; manual runs use POST.
  for (const [name, method] of [["GET", GET], ["POST", POST]] as const) {
    it(`${name} with the job secret runs the maintenance`, async () => {
      const response = await call(method, `Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, ...report });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(runConfiguredAnalyticsMaintenance).toHaveBeenCalledExactlyOnceWith(null);
    });

    it(`${name} without the secret, with a wrong one or a non-bearer scheme is refused and runs nothing`, async () => {
      for (const authorization of [undefined, `Bearer ${"x".repeat(64)}`, `Bearer ${SECRET}x`, SECRET, `Basic ${SECRET}`]) {
        expect((await call(method, authorization)).status).toBe(401);
      }
      expect(runConfiguredAnalyticsMaintenance).not.toHaveBeenCalled();
    });
  }

  it("gives the same answer when it is run again (the database function is idempotent)", async () => {
    const first = await (await call(GET, `Bearer ${SECRET}`)).json();
    const second = await (await call(GET, `Bearer ${SECRET}`)).json();
    expect(second).toEqual(first);
    expect(runConfiguredAnalyticsMaintenance).toHaveBeenCalledTimes(2);
  });

  it("refuses to run when the job secret is missing or too short, even with a matching header", async () => {
    for (const secret of ["", "short-secret"]) {
      vi.stubEnv("CRON_SECRET", secret);
      const response = await call(GET, `Bearer ${secret}`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: "not_configured" });
    }
    expect(runConfiguredAnalyticsMaintenance).not.toHaveBeenCalled();
  });

  it("answers not_deployed, without failing, while the migration is not applied", async () => {
    runConfiguredAnalyticsMaintenance.mockResolvedValue({ kind: "not_deployed" });
    const response = await call(GET, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "not_deployed" });
  });

  it("reports not_configured when the database credentials are missing", async () => {
    runConfiguredAnalyticsMaintenance.mockResolvedValue({ kind: "not_configured" });
    const response = await call(GET, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "not_configured" });
  });

  it("re-aggregates one day when asked, and refuses a malformed or out-of-range day", async () => {
    expect((await call(POST, `Bearer ${SECRET}`, "?day=2026-10-01")).status).toBe(200);
    expect(runConfiguredAnalyticsMaintenance).toHaveBeenLastCalledWith("2026-10-01");
    for (const day of ["ontem", "2026-02-31", "2026-10-01;drop"]) expect((await call(POST, `Bearer ${SECRET}`, `?day=${encodeURIComponent(day)}`)).status).toBe(400);
    expect(runConfiguredAnalyticsMaintenance).toHaveBeenCalledTimes(1);
    runConfiguredAnalyticsMaintenance.mockResolvedValue({ kind: "done", report: { ...report, status: "out_of_range" } });
    expect((await call(POST, `Bearer ${SECRET}`, "?day=2020-01-01")).status).toBe(400);
  });

  it("logs a partial run when days are still waiting", async () => {
    runConfiguredAnalyticsMaintenance.mockResolvedValue({ kind: "done", report: { ...report, pendingDays: 3 } });
    expect((await call(GET, `Bearer ${SECRET}`)).status).toBe(200);
    const line = JSON.parse(String(vi.mocked(console.warn).mock.calls.at(-1)?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ event: "analytics.maintenance", outcome: "partial", pendingDays: 3, purgedEvents: 120, aggregatedDays: 2 });
  });

  it("answers unavailable without details when the maintenance throws", async () => {
    runConfiguredAnalyticsMaintenance.mockRejectedValue(new Error("Analytics maintenance failed: 08006"));
    const response = await call(GET, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "unavailable" });
  });
});
