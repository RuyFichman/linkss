import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const WS = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({ account: vi.fn(), rpc: vi.fn() }));
vi.mock("@/modules/identity/session", () => ({ resolveAccount: mocks.account, getSupabase: async () => ({ rpc: mocks.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not_found"); } }));
vi.mock("next/link", () => ({ default: "a" }));
const { default: Page } = await import("@/app/app/conta/dados/midia/page");
const { default: Loading } = await import("@/app/app/conta/dados/midia/loading");

async function render(pagina?: string) {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ workspace: WS, pagina }) }));
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.account.mockResolvedValue({ status: "ready", workspaces: [{ workspaceId: WS, role: "owner", name: "Minha conta" }] });
  mocks.rpc.mockResolvedValue({ data: { mediaAssets: [] }, error: null });
});
describe("media export screen", () => {
  it("explains the empty state, stored format and request path", async () => {
    const html = await render();
    expect(html).toContain("Nenhuma imagem pronta");
    expect(html).toContain("originais enviados não são guardados");
    expect(html).toContain("Meus dados");
  });
  it("renders a loading state with status semantics", () => {
    expect(renderToStaticMarkup(createElement(Loading))).toContain('role="status"');
  });
  it("shows retry instructions when schema/storage inventory is unavailable", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    expect(await render()).toContain('role="alert"');
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    expect(await render()).toContain("Tente recarregar");
  });
  it("uses individual POST downloads and paginates without exposing remote URLs", async () => {
    const mediaAssets = Array.from({ length: 31 }, (_, i) => ({
      id: `${String(i).padStart(8, "0")}-2222-4222-8222-222222222222`,
      workspace_id: WS, status: "ready", variants: [{ w: 448, h: 300, bytes: 12 }],
    }));
    mocks.rpc.mockResolvedValue({ data: { mediaAssets }, error: null });
    const first = await render();
    expect((first.match(/<form/g) ?? []).length).toBe(30);
    expect(first).toContain('method="post"'); expect(first).toContain("Próxima");
    expect(first).not.toContain("storage/v1");
    const second = await render("9999");
    expect((second.match(/<form/g) ?? []).length).toBe(1);
    expect(second).toContain("Anterior"); expect(second).toContain("Página 2 de 2");
  });
  it.each(["admin", "editor"])("hides the inventory from a workspace %s", async (role) => {
    mocks.account.mockResolvedValue({ status: "ready", workspaces: [{ workspaceId: WS, role }] });
    await expect(render()).rejects.toThrow("not_found");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires a session and conceals unrelated workspaces", async () => {
    mocks.account.mockResolvedValue({ status: "anonymous" });
    await expect(render()).rejects.toThrow("redirect:/entrar");
    mocks.account.mockResolvedValue({ status: "ready", workspaces: [] });
    await expect(render()).rejects.toThrow("not_found");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("handles revoked ownership in the database after the initial account lookup", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(render()).rejects.toThrow("not_found");
  });
});
