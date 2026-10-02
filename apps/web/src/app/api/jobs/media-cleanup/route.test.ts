import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runConfiguredMediaCleanup } = vi.hoisted(() => ({ runConfiguredMediaCleanup: vi.fn() }));
vi.mock("@/modules/media/cleanup-server", () => ({ runConfiguredMediaCleanup }));

const { GET, POST } = await import("./route");

const SECRET = "c".repeat(64);
const report = { claimed: 2, removedObjects: 6, finished: 2, failed: 0, batches: 1 };

function call(method: typeof GET, authorization?: string) {
  const headers = new Headers(authorization ? { authorization } : {});
  return method(new Request("https://exemplo.test/api/jobs/media-cleanup", { method: method === GET ? "GET" : "POST", headers }));
}

describe("media cleanup job route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    runConfiguredMediaCleanup.mockReset().mockResolvedValue(report);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // Vercel Cron calls with GET and `Authorization: Bearer <CRON_SECRET>`; manual runs use POST.
  for (const [name, method] of [["GET", GET], ["POST", POST]] as const) {
    it(`${name} with the job secret runs the cleanup`, async () => {
      const response = await call(method, `Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, ...report });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(runConfiguredMediaCleanup).toHaveBeenCalledTimes(1);
    });

    it(`${name} without the secret, with a wrong one or a non-bearer scheme is refused and runs nothing`, async () => {
      for (const authorization of [undefined, `Bearer ${"x".repeat(64)}`, `Bearer ${SECRET}x`, SECRET, `Basic ${SECRET}`]) {
        const response = await call(method, authorization);
        expect(response.status).toBe(401);
      }
      expect(runConfiguredMediaCleanup).not.toHaveBeenCalled();
    });
  }

  it("refuses to run when the job secret is missing or too short, even with a matching header", async () => {
    for (const secret of ["", "short-secret"]) {
      vi.stubEnv("CRON_SECRET", secret);
      const response = await call(GET, `Bearer ${secret}`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: "not_configured" });
    }
    expect(runConfiguredMediaCleanup).not.toHaveBeenCalled();
  });

  it("reports not_configured when the database credentials are missing", async () => {
    runConfiguredMediaCleanup.mockResolvedValue(null);
    const response = await call(GET, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "not_configured" });
  });

  it("answers unavailable without details when the cleanup throws", async () => {
    runConfiguredMediaCleanup.mockRejectedValue(new Error("Media cleanup claim failed: 08006"));
    const response = await call(GET, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "unavailable" });
  });
});
