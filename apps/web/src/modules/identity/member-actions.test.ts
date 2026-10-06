import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MembersService } from "./members-service";

const WS = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP = "00000000-0000-4000-8000-00000000000a";
const INVITATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const EMAIL = "convidada@exemplo.com";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  service: {
    invite: vi.fn(),
    revokeInvitation: vi.fn(),
    changeRole: vi.fn(),
    remove: vi.fn(),
    previewInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
  },
}));

class RedirectSignal extends Error {
  constructor(readonly location: string) { super(location); }
}

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (location: string) => { throw new RedirectSignal(location); } }));
vi.mock("./members-server", () => ({ getMembersService: async () => mocks.service as unknown as MembersService }));

const { acceptInvitationAction, changeMemberRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } = await import("./member-actions");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RedirectSignal) return error.location;
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("member Server Actions", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const level of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, level).mockImplementation((line: unknown) => { logged.push(String(line)); });
    }
    mocks.refresh.mockReset();
    for (const mock of Object.values(mocks.service)) mock.mockReset();
  });

  it("returns the invitation link once and logs neither the token nor the address", async () => {
    mocks.service.invite.mockResolvedValue({ ok: true, value: { token: TOKEN, email: EMAIL, role: "editor", expiresAt: "2026-10-13T12:00:00Z" } });
    const state = await inviteMemberAction(WS, 5, { status: "idle" }, form({ email: EMAIL, role: "editor" }));
    expect(state.status).toBe("success");
    expect(state.invitation).toEqual({ link: `http://localhost:3000/app/convite/${TOKEN}`, email: EMAIL, expiresAt: "2026-10-13T12:00:00Z" });
    expect(mocks.service.invite).toHaveBeenCalledWith(WS, { email: EMAIL, role: "editor" });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"event":"members.invite"');
    expect(logged[0]).toContain('"outcome":"ok"');
    expect(logged.join("\n")).not.toContain(TOKEN);
    expect(logged.join("\n")).not.toContain(EMAIL);
    expect(logged.join("\n")).not.toContain("convite/");
  });

  it.each([
    ["forbidden", "Você não tem permissão"],
    ["not_found", "Não encontramos"],
    ["unauthenticated", "sessão expirou"],
    ["already_member", "já faz parte"],
    ["rate_limited", "Muitos convites"],
    ["limit_reached", "5 lugares"],
    ["not_deployed", "ainda não está disponível"],
    ["unavailable", "Não foi possível"],
  ])("answers a refused invitation (%s) with an error and no link", async (error, text) => {
    mocks.service.invite.mockResolvedValue({ ok: false, error });
    const state = await inviteMemberAction(WS, 5, { status: "idle" }, form({ email: EMAIL, role: "admin" }));
    expect(state).toMatchObject({ status: "error", code: error });
    expect(state.message).toContain(text);
    expect(state.invitation).toBeUndefined();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(logged.join("\n")).not.toContain(EMAIL);
  });

  it("marks the address field when it is invalid and keeps what was typed", async () => {
    mocks.service.invite.mockResolvedValue({ ok: false, error: "invalid_email" });
    const state = await inviteMemberAction(WS, 5, { status: "idle" }, form({ email: "sem-arroba", role: "editor" }));
    expect(state).toMatchObject({ status: "error", fieldErrors: { email: expect.any(String) }, values: { email: "sem-arroba", role: "editor" } });
  });

  it.each(["forbidden", "not_found", "unauthenticated", "last_owner", "unavailable"])("refuses to revoke, change a role or remove with outcome %s", async (error) => {
    mocks.service.revokeInvitation.mockResolvedValue({ ok: false, error });
    mocks.service.changeRole.mockResolvedValue({ ok: false, error });
    mocks.service.remove.mockResolvedValue({ ok: false, error });
    expect(await revokeInvitationAction(WS, INVITATION)).toMatchObject({ status: "error", code: error });
    expect(await changeMemberRoleAction(WS, MEMBERSHIP, { status: "idle" }, form({ role: "admin" }))).toMatchObject({ status: "error", code: error });
    expect(await removeMemberAction(WS, MEMBERSHIP)).toMatchObject({ status: "error", code: error });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("passes the workspace of the request and the form's role to the service", async () => {
    mocks.service.changeRole.mockResolvedValue({ ok: true, value: null });
    mocks.service.revokeInvitation.mockResolvedValue({ ok: true, value: null });
    expect(await changeMemberRoleAction(WS, MEMBERSHIP, { status: "idle" }, form({ role: "owner" }))).toMatchObject({ status: "success" });
    expect(mocks.service.changeRole).toHaveBeenCalledWith(WS, MEMBERSHIP, "owner");
    expect(await revokeInvitationAction(WS, INVITATION)).toMatchObject({ status: "success" });
    expect(mocks.service.revokeInvitation).toHaveBeenCalledWith(WS, INVITATION);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("sends someone who left back to the start and keeps the list for a removal", async () => {
    mocks.service.remove.mockResolvedValue({ ok: true, value: { self: true } });
    expect(await redirectOf(() => removeMemberAction(WS, MEMBERSHIP))).toBe("/app?saiu=conta");
    mocks.service.remove.mockResolvedValue({ ok: true, value: { self: false } });
    expect(await removeMemberAction(WS, MEMBERSHIP)).toMatchObject({ status: "success" });
  });

  it("goes to the workspace only when the invitation was accepted", async () => {
    mocks.service.acceptInvitation.mockResolvedValue({ ok: true, value: { outcome: "accepted", workspaceId: WS } });
    expect(await redirectOf(() => acceptInvitationAction(TOKEN))).toBe(`/app/w/${WS}?convite=aceito`);
    expect(logged.join("\n")).not.toContain(TOKEN);
  });

  it.each(["invalid", "wrong_account", "already_member", "limit_reached"])("stays on the page for outcome %s", async (outcome) => {
    mocks.service.acceptInvitation.mockResolvedValue({ ok: true, value: { outcome, workspaceId: null } });
    expect(await acceptInvitationAction(TOKEN)).toMatchObject({ status: "error", code: outcome });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(logged.join("\n")).toContain(`"outcome":"${outcome}"`);
    expect(logged.join("\n")).not.toContain(TOKEN);
  });

  it("reports an unavailable database without pretending the invitation is invalid", async () => {
    mocks.service.acceptInvitation.mockResolvedValue({ ok: false, error: "unavailable" });
    expect(await acceptInvitationAction(TOKEN)).toMatchObject({ status: "error", code: "unavailable" });
  });
});
