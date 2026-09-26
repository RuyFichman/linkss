import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentityPort } from "@/modules/identity/guard";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import { documentFromDraft, parsePublishedDocument } from "./document";
import { buildPublicPageMetadata } from "./metadata";
import { mapPublicPageRow, PublicPageUnavailableError, type PublicPageRow } from "./public-page";
import { resolveRouteSlug } from "./route-slug";
import { createPublishingService, publicationState, publishingErrorFromDatabase, type PublishingRepository, type PublishTarget } from "./service";
import { isAllowedSocialUrl, normalizeSocialInput, SOCIAL_NETWORK_IDS, SOCIAL_NETWORKS } from "./social";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));

/** Parses `when 'network' then array['host', ...]` from private.social_network_hosts(). */
function socialHostsInMigrations(): Record<string, string[]> {
  const sql = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8")).join("\n");
  const hosts: Record<string, string[]> = {};
  for (const match of sql.matchAll(/when '([a-z]+)' then array\[([^\]]+)\]/g)) {
    hosts[match[1] ?? ""] = [...(match[2] ?? "").matchAll(/'([^']+)'/g)].map((host) => host[1] ?? "");
  }
  return hosts;
}

describe("social links", () => {
  it("host allowlist equals private.social_network_hosts (drift guard)", () => {
    const expected = Object.fromEntries(SOCIAL_NETWORK_IDS.map((network) => [network, [...SOCIAL_NETWORKS[network].hosts]]));
    expect(socialHostsInMigrations()).toEqual(expected);
  });

  it.each([
    ["instagram", "@cafe.ipe", "https://www.instagram.com/cafe.ipe"],
    ["tiktok", "cafeipe", "https://www.tiktok.com/@cafeipe"],
    ["instagram", "instagram.com/cafeipe", "https://instagram.com/cafeipe"],
    ["youtube", "http://youtu.be/abc", "https://youtu.be/abc"],
    ["linkedin", "https://br.linkedin.com/in/ana", "https://br.linkedin.com/in/ana"],
  ] as const)("normalizes %s input %j", (network, input, expected) => {
    expect(normalizeSocialInput(network, input)).toEqual({ ok: true, url: expected });
  });

  it("rejects hosts of another network, look-alikes and credentials", () => {
    expect(normalizeSocialInput("instagram", "https://tiktok.com/@x")).toEqual({ ok: false, reason: "wrong_network" });
    expect(normalizeSocialInput("instagram", "https://instagram.com.evil.example/x")).toEqual({ ok: false, reason: "wrong_network" });
    expect(normalizeSocialInput("instagram", "https://evilinstagram.com/x")).toEqual({ ok: false, reason: "wrong_network" });
    expect(normalizeSocialInput("instagram", "https://user@instagram.com/x")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeSocialInput("instagram", "javascript:alert(1)")).toEqual({ ok: false, reason: "invalid" });
    expect(isAllowedSocialUrl("instagram", "http://instagram.com/x")).toBe(false);
  });
});

describe("published document", () => {
  const raw = {
    schemaVersion: 1,
    title: "Café Ipê",
    bio: "Cafés",
    avatarPath: null,
    socialLinks: [{ network: "instagram", url: "https://www.instagram.com/cafeipe" }, { network: "instagram", url: "https://evil.example" }, { network: "myspace", url: "https://myspace.com" }],
    blocks: [
      { id: "b1", type: "link", title: "Cardápio", url: "https://cafe.example/menu" },
      { id: "b2", type: "link", title: "XSS", url: "javascript:alert(1)" },
      { id: "b3", type: "embed", title: "Script", url: "https://x.example" },
    ],
  };

  it("keeps valid content and drops unsafe links, unknown networks and unknown block types", () => {
    const document = parsePublishedDocument(raw);
    expect(document?.socialLinks).toEqual([{ network: "instagram", url: "https://www.instagram.com/cafeipe" }]);
    expect(document?.blocks.map((block) => block.id)).toEqual(["b1"]);
  });

  it("refuses unknown schema versions and documents without a title", () => {
    expect(parsePublishedDocument({ ...raw, schemaVersion: 2 })).toBeNull();
    expect(parsePublishedDocument({ ...raw, title: " " })).toBeNull();
    expect(parsePublishedDocument([raw])).toBeNull();
  });

  it("builds the preview document like the database: hidden links are left out", () => {
    const document = documentFromDraft({
      title: "Ana", bio: "", avatarPath: null, socialLinks: [],
      blocks: [
        { id: "a", type: "link", title: "Visível", url: "https://a.example/", visible: true },
        { id: "b", type: "link", title: "Oculto", url: "https://b.example/", visible: false },
      ],
    });
    expect(document.blocks).toEqual([{ id: "a", type: "link", title: "Visível", url: "https://a.example/" }]);
  });
});

describe("public route slug", () => {
  it("serves canonical slugs, redirects other spellings and rejects junk without a lookup", () => {
    expect(resolveRouteSlug("ana-lima")).toEqual({ kind: "canonical", slug: "ana-lima" });
    expect(resolveRouteSlug("Ana-Lima")).toEqual({ kind: "redirect", slug: "ana-lima" });
    expect(resolveRouteSlug(encodeURIComponent("Café Ipê"))).toEqual({ kind: "redirect", slug: "cafe-ipe" });
    expect(resolveRouteSlug("favicon.ico")).toEqual({ kind: "invalid" });
    expect(resolveRouteSlug("ab")).toEqual({ kind: "invalid" });
    expect(resolveRouteSlug("%E0%A4%A")).toEqual({ kind: "invalid" });
    expect(resolveRouteSlug("a".repeat(500))).toEqual({ kind: "invalid" });
  });
});

describe("public page states", () => {
  const published: PublicPageRow = { state: "published", canonical_slug: "ana", document: { schemaVersion: 1, title: "Ana", bio: "", avatarPath: null, socialLinks: [], blocks: [] }, version: 3, published_at: "2026-09-26T12:00:00Z", show_badge: true };

  it("maps every database state", () => {
    expect(mapPublicPageRow(published)).toMatchObject({ state: "published", slug: "ana", version: 3, showBadge: true });
    expect(mapPublicPageRow({ ...published, state: "moved", document: null })).toEqual({ state: "moved", slug: "ana" });
    expect(mapPublicPageRow({ ...published, state: "suspended", document: null })).toEqual({ state: "suspended", slug: "ana" });
    expect(mapPublicPageRow({ ...published, state: "unpublished", document: null })).toEqual({ state: "unpublished", slug: "ana" });
    expect(mapPublicPageRow({ ...published, state: "not_found", canonical_slug: null })).toEqual({ state: "not_found" });
    expect(mapPublicPageRow({ ...published, state: "surprise" })).toEqual({ state: "not_found" });
    expect(mapPublicPageRow(null)).toEqual({ state: "not_found" });
  });

  it("throws on a corrupt snapshot so the last good cached page keeps being served", () => {
    expect(() => mapPublicPageRow({ ...published, document: { schemaVersion: 9 } })).toThrow(PublicPageUnavailableError);
  });
});

describe("public page metadata", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the configured public origin for canonical and Open Graph URLs", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://exemplo.com.br/");
    const metadata = buildPublicPageMetadata({ state: "published", slug: "ana", version: 1, publishedAt: null, showBadge: true, document: { schemaVersion: 1, title: "Ana Lima", bio: "  Nutricionista\n em SP ", avatarPath: null, socialLinks: [], blocks: [] } });
    expect(metadata.alternates?.canonical).toBe("https://exemplo.com.br/ana");
    expect(metadata.openGraph).toMatchObject({ url: "https://exemplo.com.br/ana", title: "Ana Lima", description: "Nutricionista em SP", locale: "pt_BR" });
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("falls back to a default description and truncates long bios", () => {
    const base = { state: "published" as const, slug: "ana", version: 1, publishedAt: null, showBadge: true };
    expect(buildPublicPageMetadata({ ...base, document: { schemaVersion: 1, title: "Ana", bio: "", avatarPath: null, socialLinks: [], blocks: [] } }).description).toBe("Links e contatos de Ana.");
    const long = buildPublicPageMetadata({ ...base, document: { schemaVersion: 1, title: "Ana", bio: "x".repeat(280), avatarPath: null, socialLinks: [], blocks: [] } }).description ?? "";
    expect(long.length).toBe(160);
    expect(long.endsWith("…")).toBe(true);
  });

  it("never lets unpublished, missing or suspended pages be indexed", () => {
    for (const result of [{ state: "not_found" as const }, { state: "unpublished" as const, slug: "a" }, { state: "suspended" as const, slug: "a" }]) {
      expect(buildPublicPageMetadata(result).robots).toEqual({ index: false, follow: false });
    }
  });
});

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const PAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PUB_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function target(id: string, workspaceId: string): PublishTarget {
  return { id, workspaceId, slug: id === PAGE_A ? "pagina-a" : "pagina-b", draftRevision: 4, livePublicationId: null, publishedAt: null };
}

/** Behaves like RLS: only pages in `visible` workspaces can be found. */
function fakeRepository(visible: string[]) {
  const targets = [target(PAGE_A, WS_A), target(PAGE_B, WS_B)];
  const repository: PublishingRepository = {
    findTarget: vi.fn(async (id: string) => targets.find((item) => item.id === id && visible.includes(item.workspaceId)) ?? null),
    listPublications: vi.fn(async () => []),
    publish: vi.fn(async () => ({ ok: true as const, value: { publicationId: PUB_1, version: 1, created: true } })),
    restore: vi.fn(async () => ({ ok: true as const, value: 1 })),
    unpublish: vi.fn(async () => ({ ok: true as const, value: null })),
  };
  return repository;
}

function identity(userId: string | null, roles: Record<string, WorkspaceRole>): IdentityPort {
  return { currentUserId: async () => userId, roleIn: async (_user, workspaceId) => roles[workspaceId] ?? null };
}

describe("publishing commands: server-side authorization", () => {
  it("lets editors publish and passes the reviewed revision", async () => {
    const repository = fakeRepository([WS_A]);
    const result = await createPublishingService(identity("u1", { [WS_A]: "editor" }), repository).publish(PAGE_A, "4");
    expect(result).toEqual({ ok: true, value: { slug: "pagina-a", version: 1, created: true } });
    expect(repository.publish).toHaveBeenCalledWith(PAGE_A, 4);
  });

  it("ignores a malformed expected revision instead of forwarding it", async () => {
    const repository = fakeRepository([WS_A]);
    await createPublishingService(identity("u1", { [WS_A]: "owner" }), repository).publish(PAGE_A, "4; drop table");
    expect(repository.publish).toHaveBeenCalledWith(PAGE_A, null);
  });

  it("answers not_found for another tenant's page without calling the RPCs", async () => {
    const repository = fakeRepository([WS_A]);
    const service = createPublishingService(identity("u1", { [WS_A]: "owner" }), repository);
    expect(await service.publish(PAGE_B, null)).toMatchObject({ ok: false, error: "not_found" });
    expect(await service.restore(PAGE_B, PUB_1)).toMatchObject({ ok: false, error: "not_found" });
    expect(await service.unpublish("not-a-uuid")).toMatchObject({ ok: false, error: "not_found" });
    expect(repository.publish).not.toHaveBeenCalled();
    expect(repository.restore).not.toHaveBeenCalled();
    expect(repository.unpublish).not.toHaveBeenCalled();
  });

  it("rejects anonymous callers and forged publication ids", async () => {
    const repository = fakeRepository([WS_A]);
    expect(await createPublishingService(identity(null, {}), repository).publish(PAGE_A, null)).toMatchObject({ ok: false, error: "unauthenticated" });
    expect(await createPublishingService(identity("u1", { [WS_A]: "owner" }), repository).restore(PAGE_A, "../etc")).toMatchObject({ ok: false, error: "not_found" });
    expect(repository.restore).not.toHaveBeenCalled();
  });

  it("maps database errors to actionable messages", async () => {
    expect(publishingErrorFromDatabase({ code: "LK030" })).toBe("stale");
    expect(publishingErrorFromDatabase({ code: "42501" })).toBe("forbidden");
    expect(publishingErrorFromDatabase({ code: "P0002" })).toBe("not_found");
    expect(publishingErrorFromDatabase({ code: "XX000" })).toBe("unavailable");
    const repository = fakeRepository([WS_A]);
    repository.publish = vi.fn(async () => ({ ok: false as const, error: "stale" as const }));
    const result = await createPublishingService(identity("u1", { [WS_A]: "owner" }), repository).publish(PAGE_A, "3");
    expect(result.ok === false && result.message).toContain("rascunho mudou");
  });
});

describe("publication state shown to the owner", () => {
  const publication = { id: PUB_1, version: 1, sourceRevision: 4, createdAt: "2026-09-26T12:00:00Z" };
  it("distinguishes never published, up to date, pending changes and offline", () => {
    expect(publicationState({ draftRevision: 4, livePublicationId: null }, [])).toBe("never");
    expect(publicationState({ draftRevision: 4, livePublicationId: PUB_1 }, [publication])).toBe("live_current");
    expect(publicationState({ draftRevision: 5, livePublicationId: PUB_1 }, [publication])).toBe("live_outdated");
    expect(publicationState({ draftRevision: 4, livePublicationId: null }, [publication])).toBe("offline");
  });
});
