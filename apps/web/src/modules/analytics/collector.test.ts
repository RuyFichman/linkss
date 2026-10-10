import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentFromDraft } from "@/modules/publishing/document";
import { ANALYTICS_ENDPOINT, BATCH_DELAY_MS, browserRandomId, eventForTarget, referrerContext, RETRY_DELAY_MS, startCollector, utmContext, type ClickTarget, type CollectorEnvironment } from "./collector";
import { parseClientBatch, type WireBatch } from "./contract";

// The font loader and Server Actions only exist inside the Next.js compiler and runtime.
vi.mock("@/modules/themes/fonts", () => ({ THEME_FONT_FAMILY: { system: "Arial, sans-serif", serif: "Georgia, serif", poppins: "Poppins, sans-serif", lora: "Lora, serif" } }));
vi.mock("@/modules/leads/actions", () => ({ submitLeadAction: async () => ({ status: "idle" }) }));

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const BLOCK = "a6000000-0000-4000-8000-000000000001";

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

/** The slice of the DOM the collector reads: a tag, attributes and a parent chain. */
function element(tagName: string, attributes: Record<string, string> = {}, parent: ClickTarget | null = null): ClickTarget {
  const self: ClickTarget = {
    tagName,
    getAttribute: (name) => attributes[name] ?? null,
    closest(selector) {
      const matches = selector === "a,button" ? tagName === "A" || tagName === "BUTTON" : selector === "[data-block-id]" ? "data-block-id" in attributes : false;
      return matches ? self : parent ? parent.closest(selector) : null;
    },
  };
  return self;
}

function block(type: string, tag = "A", id = BLOCK): ClickTarget {
  return element(tag, { "data-block-id": id, "data-block-type": type });
}

interface Harness {
  env: CollectorEnvironment;
  beacons: string[];
  fetches: string[];
  fire(target: "document" | "window", type: string, event?: Record<string, unknown>): void;
  runTimers(): void;
  timers: Array<{ handler: () => void; delay: number }>;
  listeners(target: "document" | "window", type: string): number;
  options(type: string): unknown;
  sent(): WireBatch[];
}

function harness(overrides: { pathname?: string; search?: string; referrer?: string; beacon?: ((url: string, body: string) => boolean) | null; fetch?: CollectorEnvironment["fetch"] | null; webdriver?: boolean; prerendering?: boolean } = {}): Harness {
  const registry = { document: new Map<string, Array<{ listener: (event: Event) => void; options: unknown }>>(), window: new Map<string, Array<{ listener: (event: Event) => void; options: unknown }>>() };
  const target = (name: "document" | "window") => ({
    addEventListener(type: string, listener: (event: Event) => void, options?: unknown) {
      registry[name].set(type, [...(registry[name].get(type) ?? []), { listener, options }]);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      registry[name].set(type, (registry[name].get(type) ?? []).filter((entry) => entry.listener !== listener));
    },
  });
  const beacons: string[] = [];
  const fetches: string[] = [];
  const timers: Harness["timers"] = [];
  let id = 0;
  const env: CollectorEnvironment = {
    document: { ...target("document"), referrer: overrides.referrer ?? "", visibilityState: "visible", prerendering: overrides.prerendering },
    window: {
      ...target("window"),
      location: { pathname: overrides.pathname ?? "/ana-lima", search: overrides.search ?? "", origin: "https://projeto.test" },
      setTimeout: (handler, delay) => timers.push({ handler, delay }),
      clearTimeout: (handle) => { if (handle !== undefined) timers[handle - 1] = { handler: () => undefined, delay: -1 }; },
    },
    navigator: {
      webdriver: overrides.webdriver,
      ...(overrides.beacon === null ? {} : { sendBeacon: (url: string, body: string) => { beacons.push(body); expect(url).toBe(ANALYTICS_ENDPOINT); return (overrides.beacon ?? (() => true))(url, body); } }),
    },
    ...(overrides.fetch === null ? {} : { fetch: overrides.fetch ?? (async (_url, init) => { fetches.push(init.body); return {}; }) }),
    randomId: () => `e0000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  };
  return {
    env, beacons, fetches, timers,
    fire(name, type, event = {}) {
      for (const entry of [...(registry[name].get(type) ?? [])]) entry.listener({ type, ...event } as unknown as Event);
    },
    runTimers() {
      for (const timer of timers.splice(0)) timer.handler();
    },
    listeners: (name, type) => (registry[name].get(type) ?? []).length,
    options: (type) => registry.document.get(type)?.[0]?.options,
    sent: () => [...beacons, ...fetches].map((body) => JSON.parse(body) as WireBatch),
  };
}

// ---------------------------------------------------------------------------------------------

describe("which event a click means", () => {
  it.each([
    ["a link block", block("link"), { type: "link_click", blockId: BLOCK, leaving: true }],
    ["text inside a link block", element("SPAN", {}, block("link")), { type: "link_click", blockId: BLOCK, leaving: true }],
    ["a WhatsApp block", block("whatsapp"), { type: "whatsapp_click", blockId: BLOCK, leaving: true }],
    ["an icon inside a social block", element("svg", {}, element("A", {}, element("LI", {}, block("social", "NAV")))), { type: "social_click", blockId: BLOCK, leaving: true }],
    ["the card of an embed block", element("SPAN", {}, block("embed")), { type: "embed_load", blockId: BLOCK, leaving: false }],
    ["the copy button of a Pix block", element("BUTTON", {}, block("pix", "SECTION")), { type: "pix_copy", blockId: BLOCK, leaving: false }],
    ["the payment link of a Pix block", element("A", {}, block("pix", "SECTION")), { type: "pix_pay_click", blockId: BLOCK, leaving: true }],
    ["the product badge", element("A", { "data-analytics": "badge" }), { type: "badge_click", blockId: null, leaving: true }],
  ] as const)("%s", (_label, target, expected) => expect(eventForTarget(target)).toEqual(expected));

  it.each([
    ["the key text of a Pix block (not a control)", element("SPAN", {}, block("pix", "SECTION"))],
    ["a text block", block("text", "P")],
    ["an image block", element("IMG", {}, block("image", "PICTURE"))],
    ["a divider", block("divider", "HR")],
    ["the submit button of a form (recorded by the server)", element("BUTTON", {}, block("form", "FORM"))],
    ["a link outside any block", element("A")],
    ["the preview's span that looks like a link block", block("link", "SPAN")],
    ["a block without an id", element("A", { "data-block-type": "link" })],
    ["a block of an unknown type", block("carousel")],
    ["nothing", null],
    ["something that is not an element", { tagName: "#text" } as unknown as ClickTarget],
  ])("ignores %s", (_label, target) => expect(eventForTarget(target)).toBeNull());
});

describe("collector", () => {
  it("sends one page view on load, with the page address and nothing else about the visitor", () => {
    const h = harness();
    startCollector("ana-lima", h.env);
    expect(h.sent()).toEqual([{ v: 1, s: "ana-lima", e: [{ i: "e0000000-0000-4000-8000-000000000001", t: "page_view" }] }]);
    expect(h.fetches).toEqual([]);
  });

  it("produces batches the server accepts", () => {
    const h = harness({ referrer: "https://l.instagram.com/?u=x", search: "?utm_source=Instagram&utm_medium=bio&utm_campaign=Primavera+2026&fbclid=abc" });
    startCollector("ana-lima", h.env);
    h.fire("document", "click", { target: block("whatsapp") });
    const batches = h.sent();
    expect(batches).toHaveLength(2);
    for (const batch of batches) expect(parseClientBatch(batch)).toMatchObject({ slug: "ana-lima", dropped: 0, referrer: "l.instagram.com", utm: { source: "Instagram", medium: "bio", campaign: "Primavera 2026" } });
  });

  it("sends only the host of the referrer and only the three UTM parameters", () => {
    const h = harness({ referrer: "https://blog.exemplo.com.br/post/123?email=ana@exemplo.com#x", search: "?utm_source=news&token=segredo&utm_term=x" });
    startCollector("ana-lima", h.env);
    const [body] = h.beacons;
    expect(JSON.parse(body ?? "{}")).toMatchObject({ r: "blog.exemplo.com.br", u: ["news", "", ""] });
    for (const secret of ["post", "123", "email", "ana@", "token", "segredo", "utm_term"]) expect(body).not.toContain(secret);
  });

  it("registers passive capture listeners, so it cannot cancel or delay a click", () => {
    const h = harness();
    startCollector("ana-lima", h.env);
    expect(h.options("click")).toEqual({ capture: true, passive: true });
    expect(h.options("auxclick")).toEqual({ capture: true, passive: true });
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const stopImmediatePropagation = vi.fn();
    h.fire("document", "click", { target: block("link"), preventDefault, stopPropagation, stopImmediatePropagation });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("never calls preventDefault and never awaits anything (source check)", () => {
    const source = readFileSync(join(SRC, "modules/analytics/collector.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(source).not.toMatch(/preventDefault\s*\(/);
    expect(source).not.toMatch(/stopPropagation|stopImmediatePropagation/);
    expect(source).not.toMatch(/\bawait\b/);
    expect(source).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB/);
  });

  it("sends a click that may leave the page at once, synchronously", () => {
    const h = harness();
    startCollector("ana-lima", h.env);
    h.fire("document", "click", { target: block("link") });
    expect(h.beacons).toHaveLength(2);
    expect(JSON.parse(h.beacons[1] ?? "{}").e).toEqual([{ i: "e0000000-0000-4000-8000-000000000002", t: "link_click", b: BLOCK }]);
    expect(h.timers).toEqual([]);
  });

  it("batches events that keep the visitor on the page", () => {
    const h = harness();
    startCollector("ana-lima", h.env);
    h.fire("document", "click", { target: element("BUTTON", {}, block("pix", "SECTION")) });
    h.fire("document", "click", { target: block("embed") });
    expect(h.beacons).toHaveLength(1);
    expect(h.timers).toEqual([expect.objectContaining({ delay: BATCH_DELAY_MS })]);
    h.runTimers();
    expect(h.beacons).toHaveLength(2);
    expect(JSON.parse(h.beacons[1] ?? "{}").e.map((event: { t: string }) => event.t)).toEqual(["pix_copy", "embed_load"]);
  });

  it("flushes what is waiting when the page is hidden or unloaded", () => {
    const h = harness();
    startCollector("ana-lima", h.env);
    h.fire("document", "click", { target: block("embed") });
    h.env.document.visibilityState = "hidden";
    h.fire("document", "visibilitychange");
    expect(h.beacons).toHaveLength(2);
    h.fire("document", "click", { target: block("embed") });
    h.fire("window", "pagehide");
    expect(h.beacons).toHaveLength(3);
  });

  it("puts a waiting event in the same batch as a click that leaves", () => {
    const h = harness();
    startCollector("ana-lima", h.env);
    h.fire("document", "click", { target: block("embed") });
    h.fire("document", "click", { target: block("link") });
    expect(JSON.parse(h.beacons[1] ?? "{}").e.map((event: { t: string }) => event.t)).toEqual(["embed_load", "link_click"]);
  });

  it("never sends more than 10 events in a batch", () => {
    const h = harness();
    startCollector("ana-lima", h.env);
    for (let index = 0; index < 23; index += 1) h.fire("document", "click", { target: block("embed") });
    h.fire("window", "pagehide");
    expect(h.sent().map((batch) => batch.e.length)).toEqual([1, 10, 10, 3]);
  });

  it("counts a middle click on a link and ignores the right button", () => {
    const h = harness();
    startCollector("ana-lima", h.env);
    h.fire("document", "auxclick", { target: block("link"), button: 2 });
    expect(h.beacons).toHaveLength(1);
    h.fire("document", "auxclick", { target: block("link"), button: 1 });
    expect(h.beacons).toHaveLength(2);
  });

  it("falls back to a keepalive fetch when sendBeacon is missing or refuses", async () => {
    for (const beacon of [null, () => false, () => { throw new Error("blocked"); }] as const) {
      const calls: Array<Parameters<NonNullable<CollectorEnvironment["fetch"]>>> = [];
      const h = harness({ beacon, fetch: async (...args) => { calls.push(args); return {}; } });
      startCollector("ana-lima", h.env);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toBe(ANALYTICS_ENDPOINT);
      expect(calls[0]?.[1]).toMatchObject({ method: "POST", keepalive: true, credentials: "same-origin" });
    }
  });

  it("retries a network failure once, with the same event ids, and then gives up", async () => {
    const bodies: string[] = [];
    const h = harness({ beacon: () => false, fetch: async (_url, init) => { bodies.push(init.body); throw new TypeError("network"); } });
    startCollector("ana-lima", h.env);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.timers).toEqual([expect.objectContaining({ delay: RETRY_DELAY_MS })]);
    h.runTimers();
    await Promise.resolve();
    await Promise.resolve();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(h.timers).toEqual([]);
  });

  it("does not retry when the server answered, whatever the status", async () => {
    const h = harness({ beacon: () => false, fetch: async () => ({ ok: false, status: 500 }) });
    startCollector("ana-lima", h.env);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.timers).toEqual([]);
  });

  it("stays silent when everything fails: no transport, a throwing fetch, a hanging endpoint", () => {
    const hanging = harness({ beacon: () => false, fetch: () => new Promise(() => undefined) });
    const throwing = harness({ beacon: () => false, fetch: () => { throw new Error("blocked by the client"); } });
    const none = harness({ beacon: null, fetch: null });
    for (const h of [hanging, throwing, none]) {
      expect(() => startCollector("ana-lima", h.env)).not.toThrow();
      expect(() => h.fire("document", "click", { target: block("link") })).not.toThrow();
      expect(() => h.fire("window", "pagehide")).not.toThrow();
    }
  });

  it("survives a hostile click target", () => {
    const h = harness();
    startCollector("ana-lima", h.env);
    const exploding = { tagName: "A", getAttribute: () => { throw new Error("boom"); }, closest: () => { throw new Error("boom"); } };
    expect(() => h.fire("document", "click", { target: exploding })).not.toThrow();
    expect(() => h.fire("document", "click", {})).not.toThrow();
    expect(h.beacons).toHaveLength(1);
  });

  it("counts a prerendered page only when it is shown", () => {
    const h = harness({ prerendering: true });
    startCollector("ana-lima", h.env);
    expect(h.beacons).toEqual([]);
    h.fire("document", "prerenderingchange");
    expect(h.beacons).toHaveLength(1);
  });

  it("sends a new view when the page comes back from the back/forward cache (the server applies the visit window)", () => {
    const h = harness();
    startCollector("ana-lima", h.env);
    h.fire("window", "pageshow", { persisted: false });
    expect(h.beacons).toHaveLength(1);
    h.fire("window", "pageshow", { persisted: true });
    expect(h.sent().map((batch) => batch.e[0]?.t)).toEqual(["page_view", "page_view"]);
    expect(h.sent()[1]?.e[0]?.i).not.toBe(h.sent()[0]?.e[0]?.i);
  });

  it.each([["/app/w/1/paginas/2/previa"], ["/app"], ["/proto/p/ana"]])("does nothing on %s", (pathname) => {
    const h = harness({ pathname });
    startCollector("ana-lima", h.env);
    expect(h.beacons).toEqual([]);
    expect(h.listeners("document", "click")).toBe(0);
  });

  it("does nothing under browser automation", () => {
    const h = harness({ webdriver: true });
    startCollector("ana-lima", h.env);
    expect(h.beacons).toEqual([]);
    expect(h.listeners("document", "click")).toBe(0);
  });

  it("marks a visit that came from the product's own app, so the server drops it", () => {
    const h = harness({ referrer: "https://projeto.test/app/w/1/paginas/2" });
    startCollector("ana-lima", h.env);
    expect(h.sent()[0]).toMatchObject({ a: true });
    expect(referrerContext("https://projeto.test/app", "https://projeto.test")).toEqual({ host: "projeto.test", fromApp: true });
    expect(referrerContext("https://projeto.test/apple", "https://projeto.test")).toEqual({ host: "projeto.test", fromApp: false });
    expect(referrerContext("https://outro.test/app/x", "https://projeto.test")).toEqual({ host: "outro.test", fromApp: false });
    expect(referrerContext("android-app://com.instagram.android/", "https://projeto.test")).toEqual({ host: "android-app://com.instagram.android", fromApp: false });
    expect(referrerContext("not a url", "https://projeto.test")).toEqual({ fromApp: false });
  });

  it("reads UTM parameters only when there is a source", () => {
    expect(utmContext("?utm_medium=bio")).toBeUndefined();
    expect(utmContext("")).toBeUndefined();
    expect(utmContext("?utm_source=" + "x".repeat(100))?.[0]).toHaveLength(64);
  });

  it("removes its listeners and flushes when stopped", () => {
    const h = harness();
    const stop = startCollector("ana-lima", h.env);
    h.fire("document", "click", { target: block("embed") });
    stop();
    expect(h.beacons).toHaveLength(2);
    for (const [target, type] of [["document", "click"], ["document", "auxclick"], ["document", "visibilitychange"], ["window", "pagehide"], ["window", "pageshow"]] as const) expect(h.listeners(target, type)).toBe(0);
  });

  it("generates UUID v4 ids with or without randomUUID", () => {
    const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) array.fill(0xab);
      return array;
    };
    expect(browserRandomId({ getRandomValues })).toBe("abababab-abab-4bab-abab-abababababab");
    expect(browserRandomId({ getRandomValues, randomUUID: () => "e0000000-0000-4000-8000-000000000001" })).toBe("e0000000-0000-4000-8000-000000000001");
  });
});

// ---------------------------------------------------------------------------------------------
// Preview and editor emit nothing
// ---------------------------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !entry.endsWith(".test.ts") ? [full] : [];
  });
}

describe("the preview, the editor and every admin surface emit nothing", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projeto.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("mounts the collector in the two public routes only (product address and custom hostname)", () => {
    const normalize = (file: string) => file.slice(SRC.length).replace(/\\/g, "/");
    const importers = sourceFiles(SRC).filter((file) => /public-page-analytics|analytics\/collector/.test(readFileSync(file, "utf8"))).map(normalize).sort();
    expect(importers).toEqual(["app/[slug]/page.tsx", "app/d/[host]/page.tsx"]);
  });

  it("keeps the collector out of the shared renderer, which the preview and the editor reuse", () => {
    for (const file of ["modules/publishing/render/public-page-view.tsx", "modules/publishing/render/embed-facade.tsx", "modules/publishing/render/pix-copy-button.tsx", "modules/publishing/render/lead-form.tsx"]) {
      expect(readFileSync(join(SRC, file), "utf8")).not.toMatch(/modules\/analytics|\/api\/events|sendBeacon/);
    }
    for (const file of sourceFiles(join(SRC, "modules/editor")).concat(sourceFiles(join(SRC, "app/app")))) {
      expect(readFileSync(file, "utf8")).not.toMatch(/analytics\/collector|public-page-analytics|\/api\/events|sendBeacon/);
    }
  });

  it("renders the preview without anything the collector would count", async () => {
    const { PublicPageView } = await import("@/modules/publishing/render/public-page-view");
    const draft = {
      title: "Studio", bio: "", avatarPath: null, theme: null,
      blocks: [
        { id: BLOCK, type: "link" as const, visible: true, title: "Site", url: "https://exemplo.com.br/" },
        { id: "a6000000-0000-4000-8000-000000000002", type: "whatsapp" as const, visible: true, label: "Zap", phone: "5511912345678", message: "" },
        { id: "a6000000-0000-4000-8000-000000000003", type: "social" as const, visible: true, items: [{ network: "instagram" as const, url: "https://www.instagram.com/studio" }] },
        { id: "a6000000-0000-4000-8000-000000000004", type: "pix" as const, visible: true, label: "Pix", keyType: "random" as const, key: "123e4567-e89b-42d3-a456-426614174000", paymentUrl: "https://pag.exemplo.com.br/x" },
        { id: "a6000000-0000-4000-8000-000000000005", type: "embed" as const, visible: true, provider: "youtube" as const, ref: "dQw4w9WgXcQ", title: "Vídeo" },
      ],
    };
    const preview = renderToStaticMarkup(createElement(PublicPageView, { document: documentFromDraft(draft), showBadge: true, interactive: false }));
    // No anchors at all and a disabled copy button: nothing resolves to an event.
    expect(preview).not.toMatch(/<a[\s>]/);
    expect(preview).not.toContain("data-analytics");
    expect(preview).toMatch(/<button[^>]*disabled/);

    const live = renderToStaticMarkup(createElement(PublicPageView, { document: documentFromDraft(draft), showBadge: true, interactive: true, slug: "studio" }));
    expect(live).toContain('data-analytics="badge"');
    for (const type of ["link", "whatsapp", "social", "pix", "embed"]) expect(live).toContain(`data-block-type="${type}"`);
    // Links stay plain anchors to their real destination: no redirect through the product.
    expect(live).toContain('href="https://exemplo.com.br/"');
    expect(live).toContain('href="https://wa.me/5511912345678"');
    expect(live).not.toMatch(/href="\/api\//);
  });
});
