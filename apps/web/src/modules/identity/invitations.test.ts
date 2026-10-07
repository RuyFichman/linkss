import { describe, expect, it, vi } from "vitest";
import { afterConfirmPath } from "./after-confirm";
import type { IdentityPort } from "./guard";
import { generateInvitationToken, hashInvitationToken } from "./invitation-token";
import {
  acceptOutcome,
  invitationExpiresAt,
  invitationPath,
  invitationStatus,
  invitationViewState,
  isInvitationPath,
  isInvitationToken,
  isValidInvitationEmail,
  memberErrorFromDatabase,
  normalizeInvitationEmail,
  parseInvitableRole,
  seatUsage,
} from "./invitations";
import { createMembersService, type MembershipRef, type MembersRepository } from "./members-service";
import type { WorkspaceRole } from "./permissions";
import { safeNextPath } from "./redirects";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const INVITATION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INVITATION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

describe("invitation e-mail (mirror of private.normalize_email and the table check)", () => {
  it.each([
    ["  Ana@Exemplo.COM ", "ana@exemplo.com"],
    ["\tana@exemplo.com\r\n", "ana@exemplo.com"],
    ["ANA+equipe@Exemplo.com.br", "ana+equipe@exemplo.com.br"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeInvitationEmail(input)).toBe(expected);
  });

  it.each(["ana@exemplo.com", "a@b.co", "ana.lima+teste@sub.exemplo.com.br"])("accepts %s", (email) => {
    expect(isValidInvitationEmail(email)).toBe(true);
  });

  it.each(["", "ana", "ana@", "@exemplo.com", "ana@exemplo", "ana lima@exemplo.com", "ana@exem plo.com", "ana@@exemplo.com", `${"a".repeat(250)}@b.co`])("refuses %j", (email) => {
    expect(isValidInvitationEmail(email)).toBe(false);
  });

  it("offers only admin and editor: ownership is never granted by invitation", () => {
    expect(parseInvitableRole("admin")).toBe("admin");
    expect(parseInvitableRole("editor")).toBe("editor");
    expect(parseInvitableRole("owner")).toBeNull();
    expect(parseInvitableRole("")).toBeNull();
    expect(parseInvitableRole(undefined)).toBeNull();
  });
});

describe("invitation token", () => {
  it("is 256 bits of the injected random source in base64url", () => {
    const token = generateInvitationToken((bytes) => bytes.fill(255));
    expect(token).toBe("_".repeat(42) + "8");
    expect(isInvitationToken(token)).toBe(true);
    expect(generateInvitationToken((bytes) => bytes.fill(0))).toBe("A".repeat(43));
  });

  it("asks the source for exactly 32 bytes and differs between calls", () => {
    const source = vi.fn((bytes: Uint8Array) => bytes);
    generateInvitationToken(source);
    expect(source.mock.calls[0]?.[0]).toHaveLength(32);
    expect(generateInvitationToken()).not.toBe(generateInvitationToken());
  });

  it("hashes with SHA-256 in hex, the value the database stores and recomputes", () => {
    expect(hashInvitationToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashInvitationToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvitationToken(TOKEN)).not.toContain(TOKEN);
  });

  it.each(["", "short", `${TOKEN}x`, TOKEN.slice(1), `${TOKEN.slice(0, 42)}/`, `${TOKEN.slice(0, 42)}=`, null, 42])("refuses a malformed token %j", (value) => {
    expect(isInvitationToken(value)).toBe(false);
  });

  it("recognizes only the exact acceptance path", () => {
    expect(isInvitationPath(invitationPath(TOKEN))).toBe(true);
    expect(safeNextPath(invitationPath(TOKEN))).toBe(invitationPath(TOKEN));
    for (const path of [`${invitationPath(TOKEN)}?x=1`, `${invitationPath(TOKEN)}/extra`, "/app/convite/", "/app", `//evil.test${invitationPath(TOKEN)}`, `https://evil.test${invitationPath(TOKEN)}`, undefined, null]) {
      expect(isInvitationPath(path)).toBe(false);
    }
  });

  it("honors the after-confirmation cookie only for an invitation path", () => {
    expect(afterConfirmPath(invitationPath(TOKEN), "/app")).toBe(invitationPath(TOKEN));
    expect(afterConfirmPath("https://evil.test/", "/app")).toBe("/app");
    expect(afterConfirmPath("/app/w/x", "/app")).toBe("/app");
    expect(afterConfirmPath(undefined, "/app")).toBe("/app");
  });
});

describe("invitation expiry and status (injected clock)", () => {
  const created = new Date("2026-10-06T12:00:00Z");
  const invitation = { expiresAt: invitationExpiresAt(created).toISOString(), revokedAt: null, acceptedAt: null };

  it("expires seven days after creation", () => {
    expect(invitation.expiresAt).toBe("2026-10-13T12:00:00.000Z");
  });

  it.each([
    ["2026-10-06T12:00:00Z", "pending"],
    ["2026-10-13T11:59:59Z", "pending"],
    ["2026-10-13T12:00:00Z", "expired"],
    ["2027-01-01T00:00:00Z", "expired"],
  ] as const)("at %s is %s", (now, status) => {
    expect(invitationStatus(invitation, new Date(now))).toBe(status);
  });

  it("lets an outcome win over the clock", () => {
    const later = new Date("2027-01-01T00:00:00Z");
    expect(invitationStatus({ ...invitation, revokedAt: "2026-10-07T00:00:00Z" }, created)).toBe("revoked");
    expect(invitationStatus({ ...invitation, acceptedAt: "2026-10-07T00:00:00Z" }, later)).toBe("accepted");
  });

  it("treats an unreadable expiry as expired", () => {
    expect(invitationStatus({ expiresAt: "not a date", revokedAt: null, acceptedAt: null }, created)).toBe("expired");
  });
});

describe("one user-facing state per database outcome", () => {
  it.each([
    ["valid", "valid"],
    ["wrong_account", "wrong_account"],
    ["already_member", "already_member"],
    ["limit_reached", "limit_reached"],
    ["invalid", "invalid"],
    ["accepted", "invalid"],
    ["expired", "invalid"],
    ["revoked", "invalid"],
    ["", "invalid"],
    [null, "invalid"],
    [undefined, "invalid"],
    [{ state: "valid" }, "invalid"],
  ])("lookup state %j is shown as %s", (state, expected) => {
    expect(invitationViewState(state)).toBe(expected);
  });

  it.each([
    ["accepted", "accepted"],
    ["wrong_account", "wrong_account"],
    ["already_member", "already_member"],
    ["limit_reached", "limit_reached"],
    ["invalid", "invalid"],
    ["valid", "invalid"],
    ["anything else", "invalid"],
    [null, "invalid"],
  ])("accept state %j is %s", (state, expected) => {
    expect(acceptOutcome(state)).toBe(expected);
  });

  it.each([
    ["22023", "invalid_email"],
    ["LK081", "already_member"],
    ["LK082", "rate_limited"],
    ["LK010", "limit_reached"],
    ["LK020", "last_owner"],
    ["42501", "forbidden"],
    ["P0002", "not_found"],
    ["PGRST116", "not_found"],
    ["PGRST202", "not_deployed"],
    ["PGRST205", "not_deployed"],
    ["42883", "not_deployed"],
    ["42P01", "not_deployed"],
    ["42703", "not_deployed"],
    ["XX000", "unavailable"],
    [undefined, "unavailable"],
  ])("SQLSTATE %s maps to %s", (code, expected) => {
    expect(memberErrorFromDatabase({ code })).toBe(expected);
  });

  it("counts open invitations as seats", () => {
    expect(seatUsage(3, 1, 5)).toEqual({ members: 3, pending: 1, used: 4, limit: 5, remaining: 1, reached: false });
    expect(seatUsage(4, 1, 5).reached).toBe(true);
    expect(seatUsage(1, 0, 1).reached).toBe(true);
    expect(seatUsage(6, 2, 5).remaining).toBe(0);
  });
});

function identity(userId: string | null, roles: Record<string, WorkspaceRole>): IdentityPort {
  return { currentUserId: async () => userId, roleIn: async (_user, workspaceId) => roles[workspaceId] ?? null };
}

const MEMBERSHIPS: Record<string, MembershipRef> = {
  owner: { id: "00000000-0000-4000-8000-00000000000a", workspaceId: WS_A, userId: "u-owner", role: "owner", status: "active" },
  admin: { id: "00000000-0000-4000-8000-00000000000b", workspaceId: WS_A, userId: "u-admin", role: "admin", status: "active" },
  editor: { id: "00000000-0000-4000-8000-00000000000c", workspaceId: WS_A, userId: "u-editor", role: "editor", status: "active" },
  other: { id: "00000000-0000-4000-8000-00000000000d", workspaceId: WS_B, userId: "u-other", role: "editor", status: "active" },
  removed: { id: "00000000-0000-4000-8000-00000000000e", workspaceId: WS_A, userId: "u-removed", role: "editor", status: "revoked" },
};

function fakeRepository(overrides: Partial<MembersRepository> = {}) {
  const repository: MembersRepository = {
    findMembership: vi.fn(async (id: string) => Object.values(MEMBERSHIPS).find((membership) => membership.id === id) ?? null),
    findInvitationWorkspace: vi.fn(async (id: string) => (id === INVITATION_A ? WS_A : id === INVITATION_B ? WS_B : null)),
    createInvitation: vi.fn(async () => ({ ok: true as const, value: { id: INVITATION_A, expiresAt: "2026-10-13T12:00:00Z" } })),
    revokeInvitation: vi.fn(async () => ({ ok: true as const, value: null })),
    changeRole: vi.fn(async () => ({ ok: true as const, value: null })),
    remove: vi.fn(async () => ({ ok: true as const, value: null })),
    previewInvitation: vi.fn(async () => ({ ok: true as const, value: { state: "valid", workspaceId: WS_A, workspaceName: "Agência", role: "editor" as const, inviterName: "Olga", expiresAt: "2026-10-13T12:00:00Z" } })),
    acceptInvitation: vi.fn(async () => ({ ok: true as const, value: { state: "accepted", workspaceId: WS_A } })),
    ...overrides,
  };
  return repository;
}

const tokens = { generate: () => TOKEN, hash: (token: string) => `hash-of-${token.length}` };
const service = (userId: string | null, roles: Record<string, WorkspaceRole>, repository: MembersRepository) => createMembersService(identity(userId, roles), repository, tokens);

describe("member commands: authorization happens on the server, before the database is called", () => {
  it("lets owners and admins invite, and sends the database a hash, never the token", async () => {
    for (const role of ["owner", "admin"] as const) {
      const repository = fakeRepository();
      const result = await service("u1", { [WS_A]: role }, repository).invite(WS_A, { email: "  Nova@Exemplo.com ", role: "editor" });
      expect(result).toEqual({ ok: true, value: { token: TOKEN, email: "nova@exemplo.com", role: "editor", expiresAt: "2026-10-13T12:00:00Z" } });
      expect(repository.createInvitation).toHaveBeenCalledWith({ workspaceId: WS_A, email: "nova@exemplo.com", role: "editor", tokenHash: "hash-of-43" });
      expect(JSON.stringify(vi.mocked(repository.createInvitation).mock.calls)).not.toContain(TOKEN);
    }
  });

  it.each([
    ["an editor", "u1", { [WS_A]: "editor" as const }, WS_A, "forbidden"],
    ["a member of another workspace", "u1", { [WS_B]: "owner" as const }, WS_A, "not_found"],
    ["a signed-in non-member", "u1", {}, WS_A, "not_found"],
    ["an anonymous caller", null, {}, WS_A, "unauthenticated"],
    ["a malformed workspace id", "u1", { [WS_A]: "owner" as const }, "not-a-uuid", "not_found"],
  ])("refuses an invitation from %s", async (_who, userId, roles, workspaceId, error) => {
    const repository = fakeRepository();
    expect(await service(userId, roles, repository).invite(workspaceId, { email: "nova@exemplo.com", role: "editor" })).toEqual({ ok: false, error });
    expect(repository.createInvitation).not.toHaveBeenCalled();
  });

  it("never invites an owner, whoever asks", async () => {
    for (const role of ["owner", "admin"] as const) {
      const repository = fakeRepository();
      expect(await service("u1", { [WS_A]: role }, repository).invite(WS_A, { email: "nova@exemplo.com", role: "owner" })).toEqual({ ok: false, error: "forbidden" });
      expect(await service("u1", { [WS_A]: role }, repository).invite(WS_A, { email: "nova@exemplo.com", role: "superuser" })).toEqual({ ok: false, error: "forbidden" });
      expect(repository.createInvitation).not.toHaveBeenCalled();
    }
  });

  it("validates the address before the database", async () => {
    const repository = fakeRepository();
    expect(await service("u1", { [WS_A]: "owner" }, repository).invite(WS_A, { email: "sem-arroba", role: "editor" })).toEqual({ ok: false, error: "invalid_email" });
    expect(await service("u1", { [WS_A]: "owner" }, repository).invite(WS_A, { email: 42, role: "editor" })).toEqual({ ok: false, error: "invalid_email" });
    expect(repository.createInvitation).not.toHaveBeenCalled();
  });

  it("passes database refusals through as one outcome each", async () => {
    for (const error of ["already_member", "rate_limited", "limit_reached", "not_deployed", "unavailable"] as const) {
      const repository = fakeRepository({ createInvitation: vi.fn(async () => ({ ok: false as const, error })) });
      expect(await service("u1", { [WS_A]: "owner" }, repository).invite(WS_A, { email: "nova@exemplo.com", role: "admin" })).toEqual({ ok: false, error });
    }
  });

  it.each([
    ["an editor", { [WS_A]: "editor" as const }, INVITATION_A, "forbidden"],
    ["another workspace's owner", { [WS_B]: "owner" as const }, INVITATION_A, "not_found"],
    ["a non-member", {}, INVITATION_A, "not_found"],
    ["an owner naming an invitation of another workspace", { [WS_A]: "owner" as const, [WS_B]: "editor" as const }, INVITATION_B, "not_found"],
    ["an owner naming an unknown invitation", { [WS_A]: "owner" as const }, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "not_found"],
    ["an owner with a malformed id", { [WS_A]: "owner" as const }, "1; drop table", "not_found"],
  ])("refuses revocation by %s", async (_who, roles, invitationId, error) => {
    const repository = fakeRepository();
    expect(await service("u1", roles, repository).revokeInvitation(WS_A, invitationId)).toEqual({ ok: false, error });
    expect(repository.revokeInvitation).not.toHaveBeenCalled();
  });

  it("revokes for owners and admins of the invitation's workspace", async () => {
    for (const role of ["owner", "admin"] as const) {
      const repository = fakeRepository();
      expect(await service("u1", { [WS_A]: role }, repository).revokeInvitation(WS_A, INVITATION_A)).toEqual({ ok: true, value: null });
      expect(repository.revokeInvitation).toHaveBeenCalledWith(INVITATION_A);
    }
  });

  it.each([
    ["an editor changing anyone", "editor", "editor", "admin", "forbidden"],
    ["an admin promoting to owner", "admin", "editor", "owner", "forbidden"],
    ["an admin demoting an owner", "admin", "owner", "editor", "forbidden"],
    ["an owner giving an unknown role", "owner", "editor", "root", "forbidden"],
  ] as const)("refuses a role change: %s", async (_case, actor, target, next, error) => {
    const repository = fakeRepository();
    expect(await service("u1", { [WS_A]: actor }, repository).changeRole(WS_A, MEMBERSHIPS[target]?.id, next)).toEqual({ ok: false, error });
    expect(repository.changeRole).not.toHaveBeenCalled();
  });

  it("allows the role changes of the matrix", async () => {
    const repository = fakeRepository();
    expect(await service("u1", { [WS_A]: "owner" }, repository).changeRole(WS_A, MEMBERSHIPS.editor?.id, "owner")).toEqual({ ok: true, value: null });
    expect(await service("u1", { [WS_A]: "admin" }, repository).changeRole(WS_A, MEMBERSHIPS.editor?.id, "admin")).toEqual({ ok: true, value: null });
    expect(repository.changeRole).toHaveBeenCalledTimes(2);
  });

  it("treats a membership of another workspace, a removed one and an unknown one as not found", async () => {
    const repository = fakeRepository();
    const owner = service("u1", { [WS_A]: "owner", [WS_B]: "owner" }, repository);
    for (const id of [MEMBERSHIPS.other?.id, MEMBERSHIPS.removed?.id, "ffffffff-ffff-4fff-8fff-ffffffffffff", "nope"]) {
      expect(await owner.changeRole(WS_A, id, "admin")).toEqual({ ok: false, error: "not_found" });
      expect(await owner.remove(WS_A, id)).toEqual({ ok: false, error: "not_found" });
    }
    expect(repository.changeRole).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it("lets anyone leave, and only owners and admins remove others (admins: non-owners)", async () => {
    const repository = fakeRepository();
    expect(await service("u-editor", { [WS_A]: "editor" }, repository).remove(WS_A, MEMBERSHIPS.editor?.id)).toEqual({ ok: true, value: { self: true } });
    expect(await service("u-editor", { [WS_A]: "editor" }, repository).remove(WS_A, MEMBERSHIPS.admin?.id)).toEqual({ ok: false, error: "forbidden" });
    expect(await service("u-admin", { [WS_A]: "admin" }, repository).remove(WS_A, MEMBERSHIPS.owner?.id)).toEqual({ ok: false, error: "forbidden" });
    expect(await service("u-admin", { [WS_A]: "admin" }, repository).remove(WS_A, MEMBERSHIPS.editor?.id)).toEqual({ ok: true, value: { self: false } });
    expect(await service("u-owner", { [WS_A]: "owner" }, repository).remove(WS_A, MEMBERSHIPS.admin?.id)).toEqual({ ok: true, value: { self: false } });
    expect(await service(null, {}, repository).remove(WS_A, MEMBERSHIPS.admin?.id)).toEqual({ ok: false, error: "unauthenticated" });
    expect(await service("u-x", {}, repository).remove(WS_A, MEMBERSHIPS.admin?.id)).toEqual({ ok: false, error: "not_found" });
    expect(repository.remove).toHaveBeenCalledTimes(3);
  });

  it("reports the last-owner guard of the database", async () => {
    const repository = fakeRepository({ remove: vi.fn(async () => ({ ok: false as const, error: "last_owner" as const })) });
    expect(await service("u-owner", { [WS_A]: "owner" }, repository).remove(WS_A, MEMBERSHIPS.owner?.id)).toEqual({ ok: false, error: "last_owner" });
  });

  it("refuses the next request of someone who was just removed", async () => {
    const repository = fakeRepository();
    const roles: Record<string, WorkspaceRole> = { [WS_A]: "admin" };
    const admin = service("u-admin", roles, repository);
    expect((await admin.invite(WS_A, { email: "a@exemplo.com", role: "editor" })).ok).toBe(true);
    delete roles[WS_A];
    expect(await admin.invite(WS_A, { email: "b@exemplo.com", role: "editor" })).toEqual({ ok: false, error: "not_found" });
    expect(await admin.revokeInvitation(WS_A, INVITATION_A)).toEqual({ ok: false, error: "not_found" });
    expect(repository.createInvitation).toHaveBeenCalledTimes(1);
  });
});

describe("invitation acceptance", () => {
  it("requires a session and never sends a malformed token to the database", async () => {
    const repository = fakeRepository();
    expect(await service(null, {}, repository).acceptInvitation(TOKEN)).toEqual({ ok: false, error: "unauthenticated" });
    expect(await service(null, {}, repository).previewInvitation(TOKEN)).toEqual({ ok: false, error: "unauthenticated" });
    for (const token of ["", "abc", `${TOKEN}!`, null, { token: TOKEN }]) {
      expect(await service("u1", {}, repository).acceptInvitation(token)).toEqual({ ok: true, value: { outcome: "invalid", workspaceId: null } });
      expect((await service("u1", {}, repository).previewInvitation(token))).toMatchObject({ ok: true, value: { state: "invalid", workspaceName: null } });
    }
    expect(repository.acceptInvitation).not.toHaveBeenCalled();
    expect(repository.previewInvitation).not.toHaveBeenCalled();
  });

  it("returns the workspace only when the database accepted", async () => {
    expect(await service("u1", {}, fakeRepository()).acceptInvitation(TOKEN)).toEqual({ ok: true, value: { outcome: "accepted", workspaceId: WS_A } });
  });

  it.each([
    ["wrong_account", null, "wrong_account", null],
    ["limit_reached", null, "limit_reached", null],
    ["already_member", WS_A, "already_member", WS_A],
    ["invalid", null, "invalid", null],
    ["something new", WS_A, "invalid", null],
    ["accepted", null, "invalid", null],
    ["accepted", "not-a-uuid", "invalid", null],
  ])("maps database state %s to one outcome", async (state, workspaceId, outcome, expectedWorkspace) => {
    const repository = fakeRepository({ acceptInvitation: vi.fn(async () => ({ ok: true as const, value: { state, workspaceId } })) });
    expect(await service("u1", {}, repository).acceptInvitation(TOKEN)).toEqual({ ok: true, value: { outcome, workspaceId: expectedWorkspace } });
  });

  it("shows nothing about the workspace unless the invitation is for the caller", async () => {
    const leaky = { workspaceId: WS_A, workspaceName: "Agência", role: "admin" as const, inviterName: "Olga", expiresAt: "2026-10-13T12:00:00Z" };
    for (const state of ["wrong_account", "invalid", "expired", "revoked", null]) {
      const repository = fakeRepository({ previewInvitation: vi.fn(async () => ({ ok: true as const, value: { state, ...leaky } })) });
      const preview = await service("u1", {}, repository).previewInvitation(TOKEN);
      expect(preview).toEqual({ ok: true, value: { state: state === "wrong_account" ? "wrong_account" : "invalid", workspaceId: null, workspaceName: null, role: null, inviterName: null, expiresAt: null } });
    }
  });

  it("shows the generic state when the lookup is refused or not deployed, and an error only when unavailable", async () => {
    for (const error of ["forbidden", "not_found", "not_deployed"] as const) {
      const repository = fakeRepository({ previewInvitation: vi.fn(async () => ({ ok: false as const, error })), acceptInvitation: vi.fn(async () => ({ ok: false as const, error })) });
      expect(await service("u1", {}, repository).previewInvitation(TOKEN)).toMatchObject({ ok: true, value: { state: "invalid" } });
      expect(await service("u1", {}, repository).acceptInvitation(TOKEN)).toEqual({ ok: true, value: { outcome: "invalid", workspaceId: null } });
    }
    const down = fakeRepository({ previewInvitation: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    expect(await service("u1", {}, down).previewInvitation(TOKEN)).toEqual({ ok: false, error: "unavailable" });
  });
});
