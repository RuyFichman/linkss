import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const WS = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), access: vi.fn(), read: vi.fn(), allow: vi.fn(), log: vi.fn() }));
vi.mock("@/modules/identity/session", () => ({ getCurrentUserId: mocks.user, getSupabase: async () => ({ rpc: mocks.rpc }), supabaseIdentity: () => ({}) }));
vi.mock("@/modules/identity/guard", async (actual) => ({ ...await actual<typeof import("@/modules/identity/guard")>(), requireWorkspaceAccess: mocks.access }));
vi.mock("@/modules/media/storage/public-reader", () => ({ readPublicMedia: mocks.read }));
vi.mock("@/lib/security/rate-limit", () => ({ allowRequest: mocks.allow }));
vi.mock("@/lib/observability/logger", () => ({ logEvent: mocks.log, correlationIdFrom: () => "test-correlation", CORRELATION_HEADER: "x-correlation-id" }));
const { POST } = await import("./route");
const { AuthorizationError } = await import("@/modules/identity/guard");
const inventory = { mediaAssets: [{ id: ID, workspace_id: WS, status: "ready", variants: [{ w: 448, h: 300, bytes: 12 }] }] };
function request(query = `?workspace=${WS}&media=${ID}&width=448`, origin = "http://localhost:3000") {
  return new NextRequest(`http://localhost:3000/app/conta/dados/exportar${query}`, { method: "POST", headers: { origin, host: "localhost:3000" } });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue(ID); mocks.access.mockResolvedValue({ role: "owner" });
  mocks.rpc.mockResolvedValue({ data: inventory, error: null }); mocks.allow.mockReturnValue(true); mocks.read.mockResolvedValue(new Uint8Array(12));
});
describe("privacy downloads", () => {
  it("serves an owner-authorized, audited attachment with private headers", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain(`${ID}-448.webp`);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await response.arrayBuffer()).byteLength).toBe(12);
    expect(mocks.rpc).toHaveBeenCalledWith("export_workspace_data", { p_workspace_id: WS });
    expect(mocks.read).toHaveBeenCalledWith(`${ID}/448.webp`, 12);
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(ID);
  });
  it("preserves personal and workspace JSON downloads", async () => {
    for (const query of ["", `?workspace=${WS}`]) {
      const response = await POST(request(query));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(inventory);
      expect(response.headers.get("content-type")).toContain("application/json");
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("refuses a different origin before inspecting identity", async () => {
    expect((await POST(request(undefined, "https://evil.example"))).status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("refuses anonymous requests", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("limits downloads before calling the database", async () => {
    mocks.allow.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["admin", "editor"])("refuses %s at the server gate", async (role) => {
    mocks.access.mockResolvedValue({ role });
    expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("hides other workspaces and never fetches their storage", async () => {
    mocks.access.mockRejectedValue(new AuthorizationError("not_found"));
    expect((await POST(request())).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["P0002", 404], ["PGRST202", 503]])("also enforces the database gate (%s)", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    expect((await POST(request())).status).toBe(status); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([`?media=${ID}&width=448`, `?workspace=${WS}&width=448`, `?workspace=${WS}&media=../x&width=448`, `?workspace=${WS}&media=${ID}&width=//evil`])("refuses invalid selections (%s)", async (query) => {
    expect((await POST(request(query))).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not fetch an asset or width missing from the authorized inventory", async () => {
    expect((await POST(request(`?workspace=${WS}&media=${ID}&width=896`))).status).toBe(404);
    mocks.rpc.mockResolvedValue({ data: { mediaAssets: [] }, error: null });
    expect((await POST(request())).status).toBe(404); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("offers a retry when storage fails and logs no upstream details", async () => {
    mocks.read.mockRejectedValue(new Error("secret upstream detail"));
    const response = await POST(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("secret");
  });
});
