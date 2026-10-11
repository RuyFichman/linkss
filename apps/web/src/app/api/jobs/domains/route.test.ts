import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runConfiguredDomainRecheck, recordJobRun } = vi.hoisted(() => ({ runConfiguredDomainRecheck: vi.fn(), recordJobRun: vi.fn() }));
vi.mock("@/modules/domains/recheck-server", () => ({ runConfiguredDomainRecheck }));
vi.mock("@/modules/ops/status-server", () => ({ recordJobRun }));

const { GET, POST } = await import("./route");

const SECRET = "c".repeat(64);
const report = { checked: 3, found: 2, missing: 1, lapsed: 0, dnsUnavailable: 0, failed: 0 };

function call(method: typeof GET, authorization?: string) {
  const headers = new Headers(authorization ? { authorization } : {});
  return method(new Request("https://exemplo.test/api/jobs/domains", { method: method === GET ? "GET" : "POST", headers }));
}

describe("domain re-verification job route", () => {
  let logs: ReturnType<typeof vi.spyOn>[];
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    logs = [vi.spyOn(console, "info").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "error").mockImplementation(() => undefined)];
    runConfiguredDomainRecheck.mockReset().mockResolvedValue({ kind: "done", report });
    recordJobRun.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  for (const [name, method] of [["GET", GET], ["POST", POST]] as const) {
    it(`${name} with the job secret runs the re-verification and records the run`, async () => {
      const response = await call(method, `Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, ...report });
      expect(recordJobRun).toHaveBeenCalledExactlyOnceWith("domains", "ok");
    });

    it(`${name} without the secret or with a wrong one is refused and runs nothing`, async () => {
      for (const authorization of [undefined, `Bearer ${"x".repeat(64)}`, SECRET, `Basic ${SECRET}`]) expect((await call(method, authorization)).status).toBe(401);
      expect(runConfiguredDomainRecheck).not.toHaveBeenCalled();
      expect(recordJobRun).not.toHaveBeenCalled();
    });
  }

  it("counts an environment without custom domains as a good run with nothing to do", async () => {
    runConfiguredDomainRecheck.mockResolvedValueOnce({ kind: "domains_off" });
    const response = await call(POST, `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: "domains_off" });
    expect(recordJobRun).toHaveBeenCalledExactlyOnceWith("domains", "ok");
  });

  it("reports a day with DNS trouble as partial, and never logs a hostname", async () => {
    runConfiguredDomainRecheck.mockResolvedValueOnce({ kind: "done", report: { ...report, dnsUnavailable: 2 } });
    await call(POST, `Bearer ${SECRET}`);
    expect(recordJobRun).toHaveBeenCalledExactlyOnceWith("domains", "partial");
    const lines = logs.flatMap((spy) => spy.mock.calls.map((args: unknown[]) => String(args[0])));
    expect(lines.some((line: string) => line.includes('"event":"domains.recheck"') && line.includes('"outcome":"partial"'))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/\.com|\.br/);
  });

  it("answers 503 before the migration, without configuration and on failure", async () => {
    runConfiguredDomainRecheck.mockResolvedValueOnce({ kind: "not_deployed" });
    expect(await (await call(POST, `Bearer ${SECRET}`)).json()).toEqual({ ok: false, error: "not_deployed" });
    runConfiguredDomainRecheck.mockResolvedValueOnce({ kind: "not_configured" });
    expect(await (await call(POST, `Bearer ${SECRET}`)).json()).toEqual({ ok: false, error: "not_configured" });
    runConfiguredDomainRecheck.mockRejectedValueOnce(new Error("Domain recheck list failed: 57014"));
    const response = await call(POST, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(recordJobRun).toHaveBeenLastCalledWith("domains", "unavailable");
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call(POST, "Bearer short")).status).toBe(503);
  });
});
