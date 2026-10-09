import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runConfiguredBillingMaintenance: vi.fn(), revalidatePublicPage: vi.fn() }));
vi.mock("@/modules/billing/server", () => ({ runConfiguredBillingMaintenance: mocks.runConfiguredBillingMaintenance }));
vi.mock("@/modules/publishing/cache", () => ({ revalidatePublicPage: mocks.revalidatePublicPage }));

const { GET, POST } = await import("./route");

const SECRET = "c".repeat(64);
const numbers = { graceExpired: 1, holdsReleased: 0, planChanges: 1, purgedEvents: 3, checked: 4, corrected: 0, failed: 0, pending: 0 };
const report = { ...numbers, slugs: ["ana-lima", "ana-lima", "cafe-ipe"] };

function call(method: typeof GET, authorization?: string) {
  return method(new Request("https://exemplo.test/api/jobs/billing", { method: method === GET ? "GET" : "POST", headers: new Headers(authorization ? { authorization } : {}) }));
}

describe("billing job route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runConfiguredBillingMaintenance.mockReset().mockResolvedValue({ kind: "done", report });
    mocks.revalidatePublicPage.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // Vercel Cron calls with GET and `Authorization: Bearer <CRON_SECRET>`; manual runs use POST.
  for (const [name, method] of [["GET", GET], ["POST", POST]] as const) {
    it(`${name} with the job secret runs the maintenance and drops the cached pages whose plan changed`, async () => {
      const response = await call(method, `Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, ...numbers });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.revalidatePublicPage.mock.calls.map((args) => args[0])).toEqual(["ana-lima", "cafe-ipe"]);
    });

    it(`${name} without the secret, with a wrong one or a non-bearer scheme is refused and runs nothing`, async () => {
      for (const authorization of [undefined, `Bearer ${"x".repeat(64)}`, `Bearer ${SECRET}x`, SECRET, `Basic ${SECRET}`]) {
        expect((await call(method, authorization)).status).toBe(401);
      }
      expect(mocks.runConfiguredBillingMaintenance).not.toHaveBeenCalled();
    });
  }

  it("refuses to run when the job secret is missing or too short, even with a matching header", async () => {
    for (const secret of ["", "short-secret"]) {
      vi.stubEnv("CRON_SECRET", secret);
      const response = await call(GET, `Bearer ${secret}`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: "not_configured" });
    }
    expect(mocks.runConfiguredBillingMaintenance).not.toHaveBeenCalled();
  });

  it("answers not_deployed, without failing, while the migration is not applied", async () => {
    mocks.runConfiguredBillingMaintenance.mockResolvedValue({ kind: "not_deployed" });
    const response = await call(GET, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "not_deployed" });
  });

  it("reports not_configured when the database credentials are missing", async () => {
    mocks.runConfiguredBillingMaintenance.mockResolvedValue({ kind: "not_configured" });
    expect(await (await call(GET, `Bearer ${SECRET}`)).json()).toEqual({ ok: false, error: "not_configured" });
  });

  it("logs a correction as a warning: a webhook was lost", async () => {
    mocks.runConfiguredBillingMaintenance.mockResolvedValue({ kind: "done", report: { ...report, corrected: 2 } });
    expect((await call(GET, `Bearer ${SECRET}`)).status).toBe(200);
    const line = JSON.parse(String(vi.mocked(console.warn).mock.calls.at(-1)?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ event: "billing.maintenance", outcome: "ok", corrected: 2, graceExpired: 1 });
    expect(line).not.toHaveProperty("slugs");
  });

  it("logs a partial run when a provider read failed or subscriptions are still waiting", async () => {
    for (const extra of [{ failed: 1 }, { pending: 30 }]) {
      mocks.runConfiguredBillingMaintenance.mockResolvedValue({ kind: "done", report: { ...report, ...extra } });
      expect((await call(GET, `Bearer ${SECRET}`)).status).toBe(200);
      expect(JSON.parse(String(vi.mocked(console.warn).mock.calls.at(-1)?.[0]))).toMatchObject({ outcome: "partial", ...extra });
    }
  });

  it("answers unavailable without details when the maintenance throws", async () => {
    mocks.runConfiguredBillingMaintenance.mockRejectedValue(new Error("Billing maintenance failed: 08006"));
    const response = await call(GET, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "unavailable" });
  });
});
