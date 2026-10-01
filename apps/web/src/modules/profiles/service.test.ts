import { describe, expect, it, vi } from "vitest";
import { planEntitlementsFromProduct } from "@/modules/entitlements";
import type { IdentityPort } from "@/modules/identity/guard";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import { initialsFor, validateProfileContent } from "./content";
import { profileErrorFromDatabase } from "./errors";
import { createProfileService, type ProfileRepository, type ProfileSummary } from "./service";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const PAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function page(id: string, workspaceId: string, slug: string): ProfileSummary {
  return {
    id, workspaceId, title: "Página", bio: "", slug, status: "draft", avatarPath: null, blocks: [], draftRevision: 1,
    livePublicationId: null, publishedAt: null, createdAt: "2026-09-25T00:00:00Z", updatedAt: "2026-09-25T00:00:00Z",
  };
}

/** Fake repository that behaves like RLS: only pages in `visible` workspaces can be read. */
function fakeRepository(visibleWorkspaces: string[], live = 0, plan: "free" | "agency" = "free") {
  const pages = [page(PAGE_A, WS_A, "pagina-a"), page(PAGE_B, WS_B, "pagina-b")];
  const repository: ProfileRepository = {
    findById: vi.fn(async (id: string) => pages.find((item) => item.id === id && visibleWorkspaces.includes(item.workspaceId)) ?? null),
    listByWorkspace: vi.fn(async () => []),
    countLive: vi.fn(async () => live),
    entitlements: vi.fn(async () => planEntitlementsFromProduct(plan)),
    insert: vi.fn(async (input) => ({ ok: true as const, value: page("cccccccc-cccc-4ccc-8ccc-cccccccccccc", input.workspaceId, input.slug) })),
    updateDraft: vi.fn(async (id: string, revision: number, draft) => ({ ok: true as const, value: { ...page(id, WS_A, "pagina-a"), ...draft, draftRevision: revision + 1 } })),
    changeSlug: vi.fn(async (_id: string, slug: string) => ({ ok: true as const, value: slug })),
    softDelete: vi.fn(async () => ({ ok: true as const, value: null })),
    checkSlug: vi.fn(async (slug: string) => ({ ok: true as const, value: { normalized: slug, status: "available" } })),
  };
  return repository;
}

function identity(userId: string | null, roles: Record<string, WorkspaceRole>): IdentityPort {
  return { currentUserId: async () => userId, roleIn: async (_user, workspaceId) => roles[workspaceId] ?? null };
}

const validInput = { title: "Café Ipê", bio: "Cafés especiais", slug: "Café Ipê" };

describe("profile commands: server-side authorization", () => {
  it("creates a page for an owner with a normalized slug", async () => {
    const repository = fakeRepository([WS_A]);
    const result = await createProfileService(identity("u1", { [WS_A]: "owner" }), repository).create(WS_A, validInput);
    expect(result).toMatchObject({ ok: true, value: { slug: "cafe-ipe", workspaceId: WS_A } });
  });

  it("rejects a forged workspace id before touching the repository", async () => {
    const repository = fakeRepository([WS_A]);
    const result = await createProfileService(identity("u1", { [WS_A]: "owner" }), repository).create(WS_B, validInput);
    expect(result).toMatchObject({ ok: false, error: "not_found" });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("rejects editors creating pages and anonymous callers", async () => {
    const repository = fakeRepository([WS_A]);
    expect(await createProfileService(identity("u1", { [WS_A]: "editor" }), repository).create(WS_A, validInput)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await createProfileService(identity(null, {}), repository).create(WS_A, validInput)).toMatchObject({ ok: false, error: "unauthenticated" });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("blocks creation at the entitlement limit with a clear message", async () => {
    const repository = fakeRepository([WS_A], 1, "free");
    const result = await createProfileService(identity("u1", { [WS_A]: "owner" }), repository).create(WS_A, validInput);
    expect(result).toMatchObject({ ok: false, error: "limit_reached" });
    expect(result.ok === false && result.message).toContain("página disponível");
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("returns field errors for invalid content and reserved slugs", async () => {
    const repository = fakeRepository([WS_A]);
    const result = await createProfileService(identity("u1", { [WS_A]: "owner" }), repository).create(WS_A, { title: " ", bio: "x".repeat(281), slug: "admin" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["bio", "slug", "title"]);
  });

  it("maps database slug conflicts to the slug field", async () => {
    const repository = fakeRepository([WS_A]);
    repository.insert = vi.fn(async () => ({ ok: false as const, error: "slug_taken" as const }));
    const result = await createProfileService(identity("u1", { [WS_A]: "owner" }), repository).create(WS_A, validInput);
    expect(result).toMatchObject({ ok: false, error: "slug_taken", fieldErrors: { slug: expect.stringContaining("já está em uso") } });
  });

  it("treats a page of another tenant as not found for every command", async () => {
    const service = createProfileService(identity("u1", { [WS_A]: "owner" }), fakeRepository([WS_A]));
    expect(await service.saveDraft(PAGE_B, { expectedRevision: 1, title: "X", bio: "", blocks: [] })).toMatchObject({ ok: false, error: "not_found" });
    expect(await service.loadDraft(PAGE_B)).toMatchObject({ ok: false, error: "not_found" });
    expect(await service.changeSlug(PAGE_B, "roubado")).toMatchObject({ ok: false, error: "not_found" });
    expect(await service.softDelete(PAGE_B)).toMatchObject({ ok: false, error: "not_found" });
    expect(await service.softDelete("not-a-uuid")).toMatchObject({ ok: false, error: "not_found" });
  });

  it("re-checks the role on the page's own workspace", async () => {
    // The page is visible (member) but the caller is only an editor there.
    const repository = fakeRepository([WS_A]);
    const service = createProfileService(identity("u1", { [WS_A]: "editor" }), repository);
    expect(await service.saveDraft(PAGE_A, { expectedRevision: 1, title: "Novo nome", bio: "", blocks: [] })).toMatchObject({ ok: true });
    expect(await service.changeSlug(PAGE_A, "novo-endereco")).toMatchObject({ ok: false, error: "forbidden" });
    expect(await service.softDelete(PAGE_A)).toMatchObject({ ok: false, error: "forbidden" });
    expect(repository.changeSlug).not.toHaveBeenCalled();
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  it("changes a slug for admins and skips no-op changes", async () => {
    const repository = fakeRepository([WS_A]);
    const service = createProfileService(identity("u1", { [WS_A]: "admin" }), repository);
    expect(await service.changeSlug(PAGE_A, "Página A")).toEqual({ ok: true, value: "pagina-a" });
    expect(repository.changeSlug).not.toHaveBeenCalled();
    expect(await service.changeSlug(PAGE_A, "Nova Página")).toEqual({ ok: true, value: "nova-pagina" });
  });

  it("checks availability locally first, then asks the database", async () => {
    const repository = fakeRepository([WS_A]);
    const service = createProfileService(identity("u1", { [WS_A]: "owner" }), repository);
    expect((await service.checkSlug("ab", WS_A)).status).toBe("too-short");
    expect(repository.checkSlug).not.toHaveBeenCalled();
    repository.checkSlug = vi.fn(async (slug: string) => ({ ok: true as const, value: { normalized: slug, status: "held" } }));
    expect(await service.checkSlug("Café Antigo", WS_A)).toMatchObject({ status: "held", valid: false, normalized: "cafe-antigo" });
  });
});

describe("profile content and errors", () => {
  it("validates title and bio like the database checks", () => {
    expect(validateProfileContent({ title: "  Café   Ipê ", bio: " Olá " })).toEqual({ ok: true, value: { title: "Café Ipê", bio: "Olá" } });
    expect(validateProfileContent({ title: "x".repeat(81), bio: "" }).ok).toBe(false);
    expect(validateProfileContent({ title: "Ok", bio: "x".repeat(281) }).ok).toBe(false);
  });

  it("builds initials for the avatar placeholder", () => {
    expect(initialsFor("café ipê")).toBe("CI");
    expect(initialsFor("Ana")).toBe("A");
    expect(initialsFor("— ")).toBe("?");
  });

  it("maps the SQLSTATE contract", () => {
    expect(["LK001", "LK002", "LK003", "23505", "LK010", "42501", "P0002", "XX000"].map((code) => profileErrorFromDatabase({ code }))).toEqual(["slug_invalid", "slug_reserved", "slug_held", "slug_taken", "limit_reached", "forbidden", "not_found", "unavailable"]);
  });
});

describe("draft autosave command", () => {
  const LINK = { id: "6f1c1d2e-0000-4000-8000-000000000001", type: "link", visible: true, title: "Site", url: "https://exemplo.com.br/" };
  const owner = () => identity("u1", { [WS_A]: "owner" });

  it("writes title, bio and blocks together against the expected revision", async () => {
    const repository = fakeRepository([WS_A]);
    const result = await createProfileService(owner(), repository).saveDraft(PAGE_A, { expectedRevision: 7, title: "  Café   Ipê ", bio: "Bio", blocks: [LINK] });
    expect(result).toEqual({ ok: true, value: { revision: 8 } });
    expect(repository.updateDraft).toHaveBeenCalledWith(PAGE_A, 7, { title: "Café Ipê", bio: "Bio", blocks: [LINK] });
  });

  it("rejects forged payloads before touching the repository", async () => {
    const repository = fakeRepository([WS_A]);
    const service = createProfileService(owner(), repository);
    const forged = [
      { expectedRevision: 1, title: "A", bio: "", blocks: [{ ...LINK, url: "javascript:alert(1)" }] },
      { expectedRevision: 1, title: "A", bio: "", blocks: [{ ...LINK, url: "JaVaScRiPt:alert(1)" }] },
      { expectedRevision: 1, title: "A", bio: "", blocks: [{ ...LINK, url: "exemplo.com.br" }] },
      { expectedRevision: 1, title: "A", bio: "", blocks: [{ ...LINK, onclick: "x" }] },
      { expectedRevision: 1, title: "A", bio: "", blocks: [{ id: LINK.id, type: "whatsapp", visible: true, label: "Zap", phone: "https://evil.example", message: "" }] },
      { expectedRevision: 1, title: "A", bio: "", blocks: [LINK, LINK] },
      { expectedRevision: 1, title: "A", bio: "", blocks: "[]" },
      { expectedRevision: "1", title: "A", bio: "", blocks: [] },
      { expectedRevision: 0, title: "A", bio: "", blocks: [] },
      { expectedRevision: 1, title: " ", bio: "", blocks: [] },
      null,
    ];
    for (const payload of forged) {
      expect(await service.saveDraft(PAGE_A, payload), JSON.stringify(payload)).toMatchObject({ ok: false, error: "validation" });
    }
    expect(repository.updateDraft).not.toHaveBeenCalled();
  });

  it("rejects anonymous callers and pages of other tenants", async () => {
    const repository = fakeRepository([WS_A]);
    expect(await createProfileService(identity(null, {}), repository).saveDraft(PAGE_A, { expectedRevision: 1, title: "A", bio: "", blocks: [] })).toMatchObject({ ok: false, error: "unauthenticated" });
    expect(await createProfileService(owner(), repository).saveDraft(PAGE_B, { expectedRevision: 1, title: "A", bio: "", blocks: [] })).toMatchObject({ ok: false, error: "not_found" });
    expect(await createProfileService(owner(), repository).saveDraft("not-a-uuid", { expectedRevision: 1, title: "A", bio: "", blocks: [] })).toMatchObject({ ok: false, error: "not_found" });
    expect(repository.updateDraft).not.toHaveBeenCalled();
  });

  it("surfaces a stale revision as a conflict and database rejections as invalid content", async () => {
    const repository = fakeRepository([WS_A]);
    const service = createProfileService(owner(), repository);
    repository.updateDraft = vi.fn(async () => ({ ok: false as const, error: "conflict" as const }));
    expect(await service.saveDraft(PAGE_A, { expectedRevision: 1, title: "A", bio: "", blocks: [] })).toMatchObject({ ok: false, error: "conflict" });
    repository.updateDraft = vi.fn(async () => ({ ok: false as const, error: "content_invalid" as const }));
    expect(await service.saveDraft(PAGE_A, { expectedRevision: 1, title: "A", bio: "", blocks: [] })).toMatchObject({ ok: false, error: "content_invalid" });
  });

  it("loads the saved draft with its revision for conflict recovery", async () => {
    const result = await createProfileService(owner(), fakeRepository([WS_A])).loadDraft(PAGE_A);
    expect(result).toEqual({ ok: true, value: { title: "Página", bio: "", blocks: [], revision: 1 } });
  });
});
