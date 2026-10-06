import { beforeEach, describe, expect, it, vi } from "vitest";

const PAGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINK = "a7000000-0000-4000-8000-000000000001";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  service: { create: vi.fn(), revoke: vi.fn(), list: vi.fn() },
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("./server", () => ({ getReportLinksService: async () => mocks.service }));

const { createReportLinkAction, revokeReportLinkAction } = await import("./actions");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("report link Server Actions", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const level of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, level).mockImplementation((line: unknown) => { logged.push(String(line)); });
    }
    mocks.refresh.mockReset();
    for (const mock of Object.values(mocks.service)) mock.mockReset();
  });

  it("returns the link once and logs neither the token nor the path", async () => {
    mocks.service.create.mockResolvedValue({ ok: true, value: { token: TOKEN, expiresAt: "2026-11-09T15:00:00Z" } });
    const state = await createReportLinkAction(PAGE, 90, { status: "idle" }, form({ period: "30", expires: "30", label: "Setembro" }));
    expect(state.status).toBe("success");
    expect(state.link).toEqual({ url: `http://localhost:3000/r/${TOKEN}`, expiresAt: "2026-11-09T15:00:00Z" });
    expect(mocks.service.create).toHaveBeenCalledWith(PAGE, { period: "30", expires: "30", label: "Setembro" }, 90);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"event":"reports.create_link"');
    expect(logged[0]).toContain('"outcome":"ok"');
    expect(logged.join("\n")).not.toContain(TOKEN);
    expect(logged.join("\n")).not.toContain("/r/");
    expect(logged.join("\n")).not.toContain("Setembro");
  });

  it.each([
    ["forbidden", "Você não tem permissão"],
    ["not_found", "não existe mais"],
    ["unauthenticated", "sessão expirou"],
    ["not_in_plan", "não estão disponíveis no plano"],
    ["too_many_active", "5 links ativos"],
    ["rate_limited", "Muitos links"],
    ["not_deployed", "ainda não estão disponíveis"],
    ["unavailable", "Não foi possível"],
  ])("answers a refused creation (%s) with an error and no link", async (error, text) => {
    mocks.service.create.mockResolvedValue({ ok: false, error });
    const state = await createReportLinkAction(PAGE, 90, { status: "idle" }, form({ period: "30", expires: "30", label: "" }));
    expect(state).toMatchObject({ status: "error", code: error });
    expect(state.message).toContain(text);
    expect(state.link).toBeUndefined();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(logged[0]).toContain(`"outcome":"${error}"`);
  });

  it("marks the field the service refused and keeps what was typed", async () => {
    mocks.service.create.mockResolvedValue({ ok: false, error: "invalid", field: "label" });
    const state = await createReportLinkAction(PAGE, 90, { status: "idle" }, form({ period: "30", expires: "30", label: "x".repeat(90) }));
    expect(state).toMatchObject({ status: "error", code: "invalid", fieldErrors: { label: "A anotação pode ter até 80 caracteres." }, values: { period: "30", expires: "30" } });
  });

  it("passes what the request sent to the service untouched, including hostile values", async () => {
    mocks.service.create.mockResolvedValue({ ok: false, error: "not_found" });
    const data = new FormData();
    data.set("period", "9999");
    data.set("label", new File(["x"], "x.txt"));
    await createReportLinkAction("not-a-uuid", Number.NaN, { status: "idle" }, data);
    // A file in a text field and a missing field are empty strings; a non-integer history is zero.
    expect(mocks.service.create).toHaveBeenCalledWith("not-a-uuid", { period: "9999", expires: "", label: "" }, 0);
  });

  it("revokes and says the link stopped working", async () => {
    mocks.service.revoke.mockResolvedValue({ ok: true, value: null });
    expect(await revokeReportLinkAction(LINK)).toEqual({ status: "success", message: "Link cancelado. Ele já não abre." });
    expect(mocks.service.revoke).toHaveBeenCalledWith(LINK);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(logged[0]).toContain('"event":"reports.revoke_link"');
  });

  it.each(["forbidden", "not_found", "unauthenticated", "not_deployed", "unavailable"] as const)("answers a refused revocation (%s) without refreshing", async (error) => {
    mocks.service.revoke.mockResolvedValue({ ok: false, error });
    expect(await revokeReportLinkAction(LINK)).toMatchObject({ status: "error", code: error });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(logged[0]).toContain(error === "unavailable" ? '"level":"error"' : '"level":"warn"');
  });
});
