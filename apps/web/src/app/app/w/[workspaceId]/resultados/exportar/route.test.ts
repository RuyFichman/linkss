import { beforeEach, describe, expect, it, vi } from "vitest";

const WS = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({ service: { report: vi.fn(), exportCsv: vi.fn() } }));
vi.mock("@/modules/analytics/server", () => ({ getWorkspaceAnalyticsService: async () => mocks.service }));

const { POST } = await import("./route");

function request(headers: Record<string, string> = { origin: "http://localhost:3000", host: "localhost:3000" }, query = "?periodo=30d"): Request {
  return new Request(`http://localhost:3000/app/w/${WS}/resultados/exportar${query}`, { method: "POST", headers });
}

const context = { params: Promise.resolve({ workspaceId: WS }) };

describe("POST /app/w/[workspaceId]/resultados/exportar", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const level of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, level).mockImplementation((line: unknown) => { logged.push(String(line)); });
    }
    mocks.service.exportCsv.mockReset();
  });

  it("returns the file as a download that no cache may keep", async () => {
    mocks.service.exportCsv.mockResolvedValue({ ok: true, value: { csv: "pagina\r\n", rows: 3 } });
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="resultados-da-conta.csv"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("pagina\r\n");
    expect(mocks.service.exportCsv).toHaveBeenCalledWith(WS, "30d");
    expect(logged[0]).toContain('"event":"analytics.workspace_export"');
    expect(logged[0]).toContain('"rows":3');
  });

  it.each([
    ["another site", { origin: "https://evil.example", host: "localhost:3000" }],
    ["no origin", { host: "localhost:3000" }],
  ])("refuses a request from %s before asking the service", async (_name, headers) => {
    const response = await POST(request(headers), context);
    expect(response.status).toBe(403);
    expect(mocks.service.exportCsv).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["not_found", 404],
    ["unavailable", 503],
  ] as const)("answers %s with %i and no file", async (error, status) => {
    mocks.service.exportCsv.mockResolvedValue({ ok: false, error });
    const response = await POST(request(), context);
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error });
  });

  it("answers 503 when the service throws, and falls back to the default period for an unknown one", async () => {
    mocks.service.exportCsv.mockRejectedValue(new Error("boom"));
    const response = await POST(request(undefined, "?periodo=1000d"), context);
    expect(response.status).toBe(503);
    expect(mocks.service.exportCsv).toHaveBeenCalledWith(WS, "7d");
  });
});
