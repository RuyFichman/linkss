import { describe, expect, it, vi } from "vitest";
import type { IdentityPort } from "@/modules/identity/guard";
import { planEntitlementsFromProduct } from "@/modules/entitlements";
import { normalizeLinkUrl, parseDraftBlocks, parseSocialLinks, validateLinkInput, validateSocialForm, type DraftLinkBlock } from "./draft-content";
import { createProfileService, type ProfileRepository, type ProfileSummary } from "./service";

describe("link validation (mirror of private.validate_profile_draft)", () => {
  it("normalizes sites, e-mail and phone destinations", () => {
    expect(normalizeLinkUrl("cafe.example/menu")).toEqual({ ok: true, url: "https://cafe.example/menu" });
    expect(normalizeLinkUrl("mailto:oi@cafe.example")).toEqual({ ok: true, url: "mailto:oi@cafe.example" });
    expect(normalizeLinkUrl("tel:+55 (11) 99999-0000")).toEqual({ ok: true, url: "tel:+5511999990000" });
  });

  it("rejects dangerous or empty destinations with a pt-BR message", () => {
    for (const value of ["javascript:alert(1)", " JAVASCRIPT:alert(1)", "data:text/html,x", "tel:", "", "ftp://x.example"]) {
      const result = normalizeLinkUrl(value);
      expect(result.ok, value).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
    }
  });

  it("validates title length and reports both fields", () => {
    expect(validateLinkInput({ title: "  Agende   pelo WhatsApp ", url: "wa.me/5511999990000" })).toEqual({ ok: true, value: { title: "Agende pelo WhatsApp", url: "https://wa.me/5511999990000" } });
    const invalid = validateLinkInput({ title: "x".repeat(81), url: "javascript:alert(1)" });
    expect(invalid.ok === false && Object.keys(invalid.errors).sort()).toEqual(["title", "url"]);
  });
});

describe("social form", () => {
  it("keeps filled networks in a stable order and drops empty ones", () => {
    expect(validateSocialForm({ tiktok: "@cafe", instagram: "cafe.ipe", youtube: "  " })).toEqual({
      ok: true,
      value: [{ network: "instagram", url: "https://www.instagram.com/cafe.ipe" }, { network: "tiktok", url: "https://www.tiktok.com/@cafe" }],
    });
  });

  it("reports which network is wrong", () => {
    const result = validateSocialForm({ instagram: "https://tiktok.com/@cafe" });
    expect(result.ok === false && result.errors.instagram).toContain("Instagram");
  });
});

describe("tolerant readers of stored JSON", () => {
  it("drop malformed entries instead of failing the page", () => {
    expect(parseDraftBlocks([{ id: "6f1c1d2e-0000-4000-8000-000000000001", type: "link", title: "A", url: "https://a.example/", visible: true }, { id: "x", type: "link" }, null, "a"])).toHaveLength(1);
    expect(parseDraftBlocks("nope")).toEqual([]);
    expect(parseSocialLinks([{ network: "instagram", url: "https://evil.example" }, { network: "x", url: "https://x.com/ana" }])).toEqual([{ network: "x", url: "https://x.com/ana" }]);
  });
});

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const PAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINK_1 = "6f1c1d2e-0000-4000-8000-000000000001";
const LINK_2 = "6f1c1d2e-0000-4000-8000-000000000002";

function link(id: string, title: string): DraftLinkBlock {
  return { id, type: "link", title, url: `https://${title.toLowerCase()}.example/`, visible: true };
}

function page(id: string, workspaceId: string): ProfileSummary {
  return {
    id, workspaceId, title: "Página", bio: "", slug: id === PAGE_A ? "pagina-a" : "pagina-b", status: "draft", avatarPath: null, socialLinks: [],
    blocks: [link(LINK_1, "Um"), link(LINK_2, "Dois")], draftRevision: 7, livePublicationId: null, publishedAt: null,
    createdAt: "2026-09-26T00:00:00Z", updatedAt: "2026-09-26T00:00:00Z",
  };
}

function fakeRepository(visible: string[]) {
  const pages = [page(PAGE_A, WS_A), page(PAGE_B, WS_B)];
  const repository: ProfileRepository & { updateDraft: ReturnType<typeof vi.fn> } = {
    findById: vi.fn(async (id: string) => pages.find((item) => item.id === id && visible.includes(item.workspaceId)) ?? null),
    listByWorkspace: vi.fn(async () => []),
    countLive: vi.fn(async () => 1),
    entitlements: vi.fn(async () => planEntitlementsFromProduct("free")),
    insert: vi.fn(),
    updateContent: vi.fn(),
    updateDraft: vi.fn(async (id: string, _revision: number, patch: { blocks?: DraftLinkBlock[] }) => ({ ok: true as const, value: { ...page(id, WS_A), ...patch } })),
    changeSlug: vi.fn(),
    softDelete: vi.fn(),
    checkSlug: vi.fn(),
  };
  return repository;
}

function identity(roles: Record<string, "owner" | "admin" | "editor">): IdentityPort {
  return { currentUserId: async () => "u1", roleIn: async (_user, workspaceId) => roles[workspaceId] ?? null };
}

describe("draft commands: authorization and optimistic concurrency", () => {
  it("adds a link at the end, writing against the revision that was read", async () => {
    const repository = fakeRepository([WS_A]);
    const result = await createProfileService(identity({ [WS_A]: "editor" }), repository).saveLink(PAGE_A, null, { title: "Três", url: "tres.example" });
    expect(result.ok && result.value.blocks.map((block) => block.title)).toEqual(["Um", "Dois", "Três"]);
    expect(repository.updateDraft).toHaveBeenCalledWith(PAGE_A, 7, expect.anything());
  });

  it("edits, moves and removes links by id", async () => {
    const repository = fakeRepository([WS_A]);
    const service = createProfileService(identity({ [WS_A]: "owner" }), repository);
    const edited = await service.saveLink(PAGE_A, LINK_2, { title: "Dois!", url: "dois.example" });
    expect(edited.ok && edited.value.blocks[1]).toMatchObject({ id: LINK_2, title: "Dois!", visible: true });
    const moved = await service.moveLink(PAGE_A, LINK_2, "up");
    expect(moved.ok && moved.value.blocks.map((block) => block.id)).toEqual([LINK_2, LINK_1]);
    const removed = await service.removeLink(PAGE_A, LINK_1);
    expect(removed.ok && removed.value.blocks.map((block) => block.id)).toEqual([LINK_2]);
  });

  it("does not touch another tenant's page or unknown link ids", async () => {
    const repository = fakeRepository([WS_A]);
    const service = createProfileService(identity({ [WS_A]: "owner" }), repository);
    expect(await service.saveLink(PAGE_B, null, { title: "X", url: "x.example" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await service.removeLink(PAGE_A, "6f1c1d2e-0000-4000-8000-00000000dead")).toMatchObject({ ok: false, error: "not_found" });
    expect(await service.updateSocialLinks(PAGE_B, { instagram: "@x" })).toMatchObject({ ok: false, error: "not_found" });
    expect(repository.updateDraft).not.toHaveBeenCalled();
  });

  it("surfaces a concurrent edit as a conflict message", async () => {
    const repository = fakeRepository([WS_A]);
    repository.updateDraft = vi.fn(async () => ({ ok: false as const, error: "conflict" as const }));
    const result = await createProfileService(identity({ [WS_A]: "owner" }), repository).removeLink(PAGE_A, LINK_1);
    expect(result).toMatchObject({ ok: false, error: "conflict" });
    expect(result.ok === false && result.message).toContain("outra aba");
  });
});
