import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRetentionReport, retentionTotal } from "@/modules/privacy/retention";

const { runConfiguredRetention } = vi.hoisted(() => ({ runConfiguredRetention: vi.fn() }));
vi.mock("@/modules/privacy/retention-server", () => ({ runConfiguredRetention }));

const { GET, POST } = await import("./route");

const SECRET = "c".repeat(64);
const report = parseRetentionReport({ leads: 3, invitations: 1, profiles: 2, pendingProfiles: 0, pendingWorkspaces: 0 });

function call(method: typeof GET, authorization?: string) {
  const headers = new Headers(authorization ? { authorization } : {});
  return method(new Request("https://exemplo.test/api/jobs/retention", { method: method === GET ? "GET" : "POST", headers }));
}

describe("retention job route", () => {
  let info: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    runConfiguredRetention.mockReset().mockResolvedValue({ kind: "done", report });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  for (const [name, method] of [["GET", GET], ["POST", POST]] as const) {
    it(`${name} with the job secret runs the purge`, async () => {
      const response = await call(method, `Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, ...report });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(runConfiguredRetention).toHaveBeenCalledOnce();
    });

    it(`${name} without the secret, with a wrong one or a non-bearer scheme is refused and runs nothing`, async () => {
      for (const authorization of [undefined, `Bearer ${"x".repeat(64)}`, `Bearer ${SECRET}x`, SECRET, `Basic ${SECRET}`]) {
        expect((await call(method, authorization)).status).toBe(401);
      }
      expect(runConfiguredRetention).not.toHaveBeenCalled();
    });
  }

  it("answers 503 and runs nothing when the job secret is missing or too short", async () => {
    for (const value of ["", "short"]) {
      vi.stubEnv("CRON_SECRET", value);
      const response = await call(POST, `Bearer ${value}`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: "not_configured" });
    }
    expect(runConfiguredRetention).not.toHaveBeenCalled();
  });

  it("answers 503 before the migration, without the service key, and when the database fails", async () => {
    runConfiguredRetention.mockResolvedValueOnce({ kind: "not_deployed" });
    expect(await (await call(POST, `Bearer ${SECRET}`)).json()).toEqual({ ok: false, error: "not_deployed" });
    runConfiguredRetention.mockResolvedValueOnce({ kind: "not_configured" });
    expect(await (await call(POST, `Bearer ${SECRET}`)).json()).toEqual({ ok: false, error: "not_configured" });
    runConfiguredRetention.mockRejectedValueOnce(new Error("Retention maintenance failed: 57014"));
    const response = await call(POST, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "unavailable" });
  });

  it("logs counts and says partial while a page still waits for its image files", async () => {
    runConfiguredRetention.mockResolvedValueOnce({ kind: "done", report: { ...report, pendingProfiles: 2 } });
    await call(POST, `Bearer ${SECRET}`);
    const line = JSON.parse(String(info.mock.calls.at(-1)?.[0]));
    expect(line).toMatchObject({ event: "retention.maintenance", outcome: "partial", leads: 3, removed: 6, pendingProfiles: 2 });
  });
});

describe("retention report", () => {
  it("reads the counters and treats anything else as zero", () => {
    expect(parseRetentionReport({ leads: 2, auditEvents: "9", slugHistory: -1, workspaces: 1.5, extra: 4 })).toMatchObject({ leads: 2, auditEvents: 0, slugHistory: 0, workspaces: 0, pendingProfiles: 0 });
    expect(retentionTotal(parseRetentionReport(null))).toBe(0);
    expect(retentionTotal(parseRetentionReport({ leads: 2, profiles: 1, pendingProfiles: 7 }))).toBe(3);
  });
});
