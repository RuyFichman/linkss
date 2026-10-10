import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_PAGE_COPY } from "@/content/public-page";
import { contentSecurityPolicy, publicPageSource } from "@/lib/security/response-headers";
import type { IdentityPort } from "@/modules/identity/guard";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import { RESERVED_SLUGS } from "@/modules/profiles/reserved-slugs";
import { buildPublicPageMetadata } from "@/modules/publishing/metadata";
import { mapPublicPageRow } from "@/modules/publishing/public-page";
import nextConfig from "../../../next.config";
import { consentStorageKey, GA_SCRIPT, loadPixels, META_PIXEL_SCRIPT, parseStoredConsent, serializeConsent, type PixelHost } from "./loader";
import { parsePixelsInput, parsePublicPixels } from "./model";
import { createPixelsService, pixelsErrorFromDatabase, type PixelsRepository } from "./service";

const WS_A = "11111111-1111-4111-8111-111111111111";
const PAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const META = "1234567890123456";
const GA = "G-AB12CD34EF";
const SRC = fileURLToPath(new URL("../../", import.meta.url));

describe("identifiers (mirror of public.set_profile_pixels)", () => {
  it("accepts identifiers, normalizes them, and treats empty as off", () => {
    expect(parsePixelsInput({ meta: ` ${META} `, ga: "g-ab12cd34ef" })).toEqual({ ok: true, value: { metaPixelId: META, gaMeasurementId: GA } });
    expect(parsePixelsInput({ meta: "", ga: "  " })).toEqual({ ok: true, value: { metaPixelId: null, gaMeasurementId: null } });
    expect(parsePixelsInput({ meta: undefined, ga: null })).toEqual({ ok: true, value: { metaPixelId: null, gaMeasurementId: null } });
  });

  it.each([
    ["<script>alert(1)</script>", "", "meta"], ["12345", "", "meta"], ["1234567890123456x", "", "meta"], [`${META}'); alert(1);//`, "", "meta"],
    ["", "GTM-ABC1234", "ga"], ["", "UA-12345-1", "ga"], ["", "G-", "ga"], ["", "G-AB12&x=1", "ga"], ["", "https://evil.example/x.js", "ga"],
  ])("refuses meta=%j ga=%j", (meta, ga, field) => {
    expect(parsePixelsInput({ meta, ga })).toEqual({ ok: false, field });
  });

  it("gives the public page only well-formed identifiers, whatever the row holds", () => {
    expect(parsePublicPixels({ meta: META, ga: GA })).toEqual({ meta: META, ga: GA });
    expect(parsePublicPixels({ ga: GA })).toEqual({ ga: GA });
    expect(parsePublicPixels({ meta: "<script>", ga: GA, extra: "https://evil.example" })).toEqual({ ga: GA });
    for (const value of [null, undefined, "x", [], {}, { meta: 123 }, { meta: "", ga: "GTM-1234567" }]) expect(parsePublicPixels(value)).toBeNull();
  });

  it("maps each SQLSTATE of ADR 0017 to one outcome", () => {
    expect(pixelsErrorFromDatabase({ code: "22023", details: "meta" })).toEqual({ error: "invalid", field: "meta" });
    expect(pixelsErrorFromDatabase({ code: "22023", details: "ga" })).toEqual({ error: "invalid", field: "ga" });
    expect(pixelsErrorFromDatabase({ code: "22023" })).toEqual({ error: "invalid" });
    expect(pixelsErrorFromDatabase({ code: "LK010" })).toEqual({ error: "not_in_plan" });
    expect(pixelsErrorFromDatabase({ code: "42501" })).toEqual({ error: "forbidden" });
    expect(pixelsErrorFromDatabase({ code: "P0002" })).toEqual({ error: "not_found" });
    expect(pixelsErrorFromDatabase({ code: "PGRST202" })).toEqual({ error: "not_deployed" });
    expect(pixelsErrorFromDatabase({ code: "XX000" })).toEqual({ error: "unavailable" });
  });
});

describe("pixels service", () => {
  function setup(role: WorkspaceRole | null, userId: string | null = "user-1") {
    const identity: IdentityPort = { currentUserId: async () => userId, roleIn: async (_user, workspaceId) => (workspaceId === WS_A ? role : null) };
    const repository: PixelsRepository = {
      findProfileWorkspace: vi.fn(async (profileId) => (profileId === PAGE_A ? WS_A : null)),
      find: vi.fn(async () => ({ ok: true as const, value: { metaPixelId: META, gaMeasurementId: null } })),
      set: vi.fn(async () => ({ ok: true as const, value: { slug: "loja", isLive: true } })),
    };
    return { service: createPixelsService(identity, repository), repository };
  }

  it("owners and admins set; editors only see; strangers see nothing", async () => {
    for (const role of ["owner", "admin"] as const) {
      const { service, repository } = setup(role);
      expect(await service.set(PAGE_A, { meta: META, ga: "g-ab12cd34ef" })).toEqual({ ok: true, value: { slug: "loja", isLive: true } });
      expect(repository.set).toHaveBeenCalledWith(PAGE_A, { metaPixelId: META, gaMeasurementId: GA });
    }
    const editor = setup("editor");
    expect(await editor.service.get(PAGE_A)).toMatchObject({ ok: true, value: { metaPixelId: META } });
    expect(await editor.service.set(PAGE_A, { meta: META, ga: "" })).toEqual({ ok: false, error: "forbidden" });
    expect(editor.repository.set).not.toHaveBeenCalled();
    const stranger = setup(null);
    expect(await stranger.service.get(PAGE_A)).toEqual({ ok: false, error: "not_found" });
    expect(await stranger.service.set(PAGE_A, { meta: META, ga: "" })).toEqual({ ok: false, error: "not_found" });
    expect(await setup("owner", null).service.set(PAGE_A, { meta: META, ga: "" })).toEqual({ ok: false, error: "unauthenticated" });
    expect(await setup("owner").service.set("not-a-uuid", { meta: META, ga: "" })).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a malformed identifier before the database", async () => {
    const { service, repository } = setup("owner");
    expect(await service.set(PAGE_A, { meta: "<script>", ga: "" })).toEqual({ ok: false, error: "invalid", field: "meta" });
    expect(await service.set(PAGE_A, { meta: "", ga: "GTM-ABC1234" })).toEqual({ ok: false, error: "invalid", field: "ga" });
    expect(repository.set).not.toHaveBeenCalled();
  });
});

describe("loader (runs in the visitor's browser, after consent)", () => {
  function host() {
    const scripts: Array<{ async: boolean; src: string }> = [];
    const fake: PixelHost = { window: {}, document: { createElement: () => ({ async: false, src: "" }), head: { appendChild: (node) => scripts.push(node as { async: boolean; src: string }) } } };
    return { fake, scripts };
  }

  it("adds exactly the two vendor scripts, at fixed addresses, and reports one page view to each", () => {
    const { fake, scripts } = host();
    expect(loadPixels(fake, { meta: META, ga: GA })).toEqual(["meta", "ga"]);
    expect(scripts).toEqual([{ async: true, src: META_PIXEL_SCRIPT }, { async: true, src: `${GA_SCRIPT}?id=${GA}` }]);
    expect((fake.window.fbq as { queue: unknown[][] }).queue).toEqual([["init", META], ["track", "PageView"]]);
    const dataLayer = (fake.window.dataLayer as ArrayLike<unknown>[]).map((entry) => Array.from(entry));
    expect(dataLayer[0]?.[0]).toBe("js");
    expect(dataLayer[1]).toEqual(["config", GA]);
    // gtag.js needs `arguments` objects in the queue, not arrays.
    expect(Array.isArray((fake.window.dataLayer as unknown[])[0])).toBe(false);
  });

  it("loads only what is configured, once, and nothing for a malformed identifier", () => {
    const only = host();
    expect(loadPixels(only.fake, { ga: GA })).toEqual(["ga"]);
    expect(only.scripts).toHaveLength(1);
    expect(only.fake.window.fbq).toBeUndefined();
    loadPixels(only.fake, { ga: GA });
    expect(only.scripts).toHaveLength(1);

    const bad = host();
    expect(loadPixels(bad.fake, { meta: "1'); alert(1);//", ga: "G-AB12&callback=evil" })).toEqual([]);
    expect(bad.scripts).toEqual([]);
    expect(bad.fake.window).toEqual({});
  });

  it("remembers the choice per page and per set of identifiers", () => {
    expect(consentStorageKey("loja")).toBe("lnk_pixel_consent:loja");
    const pixels = { meta: META, ga: GA };
    expect(parseStoredConsent(serializeConsent("granted", pixels), pixels)).toBe("granted");
    expect(parseStoredConsent(serializeConsent("denied", pixels), pixels)).toBe("denied");
    // A new identifier (another tool, another account) asks again.
    expect(parseStoredConsent(serializeConsent("granted", { meta: META }), pixels)).toBeNull();
    expect(parseStoredConsent(serializeConsent("granted", pixels), { meta: "9999999999999999", ga: GA })).toBeNull();
    for (const stored of [null, "", "granted", "yes:x", `maybe:${META}|${GA}`]) expect(parseStoredConsent(stored, pixels)).toBeNull();
  });
});

describe("where pixels can run", () => {
  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }
  const relative = (path: string) => path.slice(SRC.length).replace(/\\/g, "/");
  const importers = (pattern: RegExp) => sources(SRC).filter((path) => pattern.test(readFileSync(path, "utf8"))).map(relative).sort();

  it("mounts the consent notice only through the published page, which only the two public routes render", () => {
    expect(importers(/pixels\/components\/pixel-consent/)).toEqual(["modules/publishing/render/published-page.tsx"]);
    expect(importers(/render\/published-page/)).toEqual(["app/[slug]/page.tsx", "app/d/[host]/page.tsx"]);
    expect(importers(/pixels\/loader|from "\.\.\/loader"/)).toEqual(["modules/pixels/components/pixel-consent.tsx"]);
  });

  it("keeps the vendor addresses out of everything but the loader and the policy", () => {
    const mentioning = importers(/connect\.facebook\.net|googletagmanager\.com/);
    expect(mentioning).toEqual(["lib/security/response-headers.ts", "modules/pixels/loader.ts"]);
    // The shared renderer (preview, editor) and the report never reference pixels.
    for (const file of ["modules/publishing/render/public-page-view.tsx", ...sources(join(SRC, "modules/editor")).map(relative), ...sources(join(SRC, "app/r")).map(relative), ...sources(join(SRC, "modules/reports")).map(relative)]) {
      expect(readFileSync(join(SRC, file), "utf8")).not.toMatch(/modules\/pixels|PixelConsent|fbq|gtag/);
    }
  });

  it("offers refusing as plainly as accepting and names who receives the data", () => {
    const copy = PUBLIC_PAGE_COPY.consent;
    expect(copy.accept).toBe("Aceitar");
    expect(copy.refuse).toBe("Recusar");
    expect(copy.text(copy.meta)).toContain("Meta Pixel");
    expect(copy.text(`${copy.meta}${copy.and}${copy.ga}`)).toContain("essas empresas");
    expect(copy.text(copy.ga)).toContain("essa empresa");
  });
});

describe("Content-Security-Policy: vendor origins only on public pages", () => {
  const VENDORS = /connect\.facebook\.net|googletagmanager\.com|google-analytics\.com|www\.facebook\.com/;

  it("the baseline policy has no vendor origin; the public-page policy adds exactly them", () => {
    const base = contentSecurityPolicy("https://project.supabase.co", false);
    const page = contentSecurityPolicy("https://project.supabase.co", false, undefined, { publicPage: true });
    expect(base).not.toMatch(VENDORS);
    expect(page).toContain("script-src 'self' 'unsafe-inline' https://connect.facebook.net https://www.googletagmanager.com;");
    expect(page).toContain("connect-src 'self' https://project.supabase.co https://www.facebook.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com");
    expect(page).toContain("img-src 'self' data: blob: https://project.supabase.co https://www.facebook.com https://*.google-analytics.com https://*.googletagmanager.com");
    for (const directive of ["script-src-attr 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'", "frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://open.spotify.com"]) expect(page).toContain(directive);
    expect(page).not.toContain("unsafe-eval");
    // Everything else is identical.
    expect(page.replace(/ https:\/\/(connect\.facebook\.net|www\.googletagmanager\.com|www\.facebook\.com|\*\.google-analytics\.com|\*\.analytics\.google\.com|\*\.googletagmanager\.com)/g, "")).toBe(base);
  });

  it("the public-page source matches addresses of pages and none of the product's own routes", () => {
    const pattern = new RegExp(`^${(/^\/:slug\((.*)\)$/.exec(publicPageSource(RESERVED_SLUGS))?.[1] ?? "")}$`);
    for (const slug of ["ana-lima", "cafe-ipe", "loja123", "apps", "entrar-aqui", "app-da-ana"]) expect(pattern.test(slug)).toBe(true);
    for (const route of [...RESERVED_SLUGS, "Ana", "a_b", "a/b", "-ana", "ana-", ""]) expect(pattern.test(route)).toBe(false);
  });

  it("next.config.ts widens the policy only for /[slug] and the root of a custom hostname, and reports keep theirs", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const csp = (rule: (typeof rules)[number]) => rule.headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
    expect(rules.map((rule) => rule.source)).toEqual(["/:path*", publicPageSource(RESERVED_SLUGS), "/", "/r/:path*"]);
    expect(csp(rules[0] as (typeof rules)[number])).not.toMatch(VENDORS);
    expect(csp(rules[1] as (typeof rules)[number])).toMatch(VENDORS);
    expect(csp(rules[2] as (typeof rules)[number])).toMatch(VENDORS);
    // The root rule applies only where the Host is not the product's own: the marketing home keeps the baseline.
    expect(rules[2]).toMatchObject({ missing: [{ type: "host" }] });
    expect(rules[1]).not.toHaveProperty("missing");
  });
});

describe("public page read: domain and pixels are decided by the database on every read", () => {
  afterEach(() => vi.unstubAllEnvs());
  const document = { schemaVersion: 2, sourceSchemaVersion: 2, title: "Loja", bio: "", avatarPath: null, theme: null, blocks: [] };
  const row = { state: "published", canonical_slug: "loja", document, version: 3, published_at: null, show_badge: false };

  it("maps the two new columns and tolerates a database that does not have them yet", () => {
    expect(mapPublicPageRow(row)).toMatchObject({ state: "published", customDomain: null, pixels: null });
    expect(mapPublicPageRow({ ...row, custom_domain: "www.loja.com.br", pixels: { meta: META } })).toMatchObject({ customDomain: "www.loja.com.br", pixels: { meta: META } });
    expect(mapPublicPageRow({ ...row, custom_domain: "https://evil.example/x", pixels: { meta: "<script>" } })).toMatchObject({ customDomain: null, pixels: null });
  });

  it("makes the custom domain the canonical address at both of the page's addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://linkfav.com");
    const result = mapPublicPageRow({ ...row, custom_domain: "www.loja.com.br" });
    expect(buildPublicPageMetadata(result).alternates?.canonical).toBe("https://www.loja.com.br");
    const viaDomain = buildPublicPageMetadata(result, { viaCustomDomain: true });
    expect(viaDomain.openGraph).toMatchObject({ url: "https://www.loja.com.br", images: [{ url: "https://linkfav.com/loja/opengraph-image" }] });
    expect(buildPublicPageMetadata(mapPublicPageRow(row)).alternates?.canonical).toBe("https://linkfav.com/loja");
    expect(buildPublicPageMetadata(mapPublicPageRow(row)).openGraph).not.toHaveProperty("images");
  });
});
