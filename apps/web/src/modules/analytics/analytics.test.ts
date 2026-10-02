import { describe, expect, it } from "vitest";
import { analyticsSigningSecret, serializeIngestPayload, signIngestPayload } from "./attestation";
import { ANALYTICS_EVENT_TYPES, CLIENT_EVENT_TYPES, EVENT_BLOCK_TYPE, isValueAction, parseClientBatch, VALUE_ACTION_TYPES } from "./contract";
import { analyticsToCsv } from "./csv";
import type { DayRow } from "./dashboard";
import { addDays, daysBetween, daysInWindow, formatDay, isDay, localDay, parsePeriod, periodIsAvailable, periodWindow } from "./dates";
import { classifyDevice, isAutomatedUserAgent, normalizeCountry } from "./device";
import { hasSessionCookie, parseIngestOutcome, prepareIngestion, type IngestInput } from "./ingest";
import { classifySource, normalizeUtm, normalizeUtmValue, referrerHost, TRAFFIC_SOURCES } from "./sources";
import { visitorHash } from "@/modules/leads/visitor-hash";
import { analyticsVisitorHashes } from "./visitor-hash";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATION = readFileSync(fileURLToPath(new URL("../../../../../supabase/migrations/202610020002_customer_analytics.sql", import.meta.url)), "utf8");
const EVENT = "e0000000-0000-4000-8000-000000000001";
const BLOCK = "a6000000-0000-4000-8000-000000000001";
const TZ = "America/Sao_Paulo";

function enumValues(name: string): string[] {
  const body = new RegExp(`create type public\\.${name} as enum \\(([^;]+)\\);`).exec(MIGRATION)?.[1] ?? "";
  return [...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? "");
}

describe("event contract (mirror of the SQL enums)", () => {
  it("lists the same event types, sources and device classes as the database", () => {
    expect(enumValues("analytics_event_type")).toEqual([...ANALYTICS_EVENT_TYPES]);
    expect(enumValues("analytics_source")).toEqual([...TRAFFIC_SOURCES]);
    expect(enumValues("analytics_device")).toEqual(["mobile", "tablet", "desktop", "unknown"]);
  });

  it("never lets a browser send form_submit, which the database records itself", () => {
    expect(CLIENT_EVENT_TYPES).not.toContain("form_submit");
    expect(parseClientBatch({ v: 1, s: "ana", e: [{ i: EVENT, t: "form_submit", b: BLOCK }] })).toMatchObject({ events: [], dropped: 1 });
  });

  it("classifies contact and payment actions as results and link clicks as navigation", () => {
    expect([...VALUE_ACTION_TYPES]).toEqual(["whatsapp_click", "pix_copy", "pix_pay_click", "form_submit"]);
    expect(isValueAction("link_click")).toBe(false);
    expect(EVENT_BLOCK_TYPE).toMatchObject({ page_view: null, badge_click: null, pix_copy: "pix", pix_pay_click: "pix", embed_load: "embed" });
  });

  it("normalizes a valid batch", () => {
    expect(parseClientBatch({ v: 1, s: "ana-lima", r: "l.instagram.com", u: ["Instagram", "bio", ""], e: [{ i: EVENT, t: "page_view" }, { i: "e0000000-0000-4000-8000-000000000002", t: "link_click", b: BLOCK }], extra: "ignored" }))
      .toEqual({
        slug: "ana-lima", referrer: "l.instagram.com", fromApp: false, utm: { source: "Instagram", medium: "bio", campaign: null }, dropped: 0,
        events: [{ id: EVENT, type: "page_view", blockId: null }, { id: "e0000000-0000-4000-8000-000000000002", type: "link_click", blockId: BLOCK }],
      });
  });

  it.each([
    ["not an object", "page_view"],
    ["an array", [1]],
    ["unknown version", { v: 2, s: "ana", e: [{ i: EVENT, t: "page_view" }] }],
    ["missing version", { s: "ana", e: [{ i: EVENT, t: "page_view" }] }],
    ["address with a path", { v: 1, s: "ana/../admin", e: [{ i: EVENT, t: "page_view" }] }],
    ["uppercase address", { v: 1, s: "Ana", e: [{ i: EVENT, t: "page_view" }] }],
    ["address too long", { v: 1, s: "a".repeat(41), e: [{ i: EVENT, t: "page_view" }] }],
    ["no events", { v: 1, s: "ana", e: [] }],
    ["events not a list", { v: 1, s: "ana", e: {} }],
    ["too many events", { v: 1, s: "ana", e: Array.from({ length: 11 }, (_, n) => ({ i: `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, t: "page_view" })) }],
  ])("refuses a batch: %s", (_label, input) => expect(parseClientBatch(input)).toBeNull());

  it.each([
    ["unknown type", { i: EVENT, t: "purchase" }],
    ["malformed id", { i: "not-a-uuid", t: "page_view" }],
    ["uppercase id", { i: EVENT.toUpperCase(), t: "page_view" }],
    ["page view naming a block", { i: EVENT, t: "page_view", b: BLOCK }],
    ["block event without a block", { i: EVENT, t: "link_click" }],
    ["markup as block id", { i: EVENT, t: "link_click", b: "<script>alert(1)</script>" }],
    ["legacy social id on a link", { i: EVENT, t: "link_click", b: "legacy-social" }],
    ["not an object", "page_view"],
  ])("drops one malformed event and keeps the rest: %s", (_label, event) => {
    const batch = parseClientBatch({ v: 1, s: "ana", e: [event, { i: "e0000000-0000-4000-8000-000000000009", t: "badge_click" }] });
    expect(batch?.events).toEqual([{ id: "e0000000-0000-4000-8000-000000000009", type: "badge_click", blockId: null }]);
    expect(batch?.dropped).toBe(1);
  });

  it("accepts the legacy social row and removes ids repeated inside a batch", () => {
    const batch = parseClientBatch({ v: 1, s: "ana", e: [{ i: EVENT, t: "social_click", b: "legacy-social" }, { i: EVENT, t: "social_click", b: "legacy-social" }] });
    expect(batch?.events).toHaveLength(1);
    expect(batch?.dropped).toBe(1);
  });

  it("ignores oversized raw values instead of truncating them into something else", () => {
    const batch = parseClientBatch({ v: 1, s: "ana", r: "x".repeat(300), u: ["y".repeat(300), 5, null], e: [{ i: EVENT, t: "page_view" }] });
    expect(batch).toMatchObject({ referrer: null, utm: { source: null, medium: null, campaign: null } });
  });
});

describe("traffic source: the referrer is reduced to a host, then to a class", () => {
  it.each([
    ["", null, "direct"],
    [null, null, "direct"],
    ["l.instagram.com", null, "instagram"],
    ["https://l.instagram.com/?u=https%3A%2F%2Fexemplo.com%2Fa&e=AT0x", null, "instagram"],
    ["www.instagram.com", null, "instagram"],
    ["android-app://com.instagram.android", null, "instagram"],
    ["android-app://com.instagram.android/", null, "instagram"],
    ["lm.facebook.com", null, "facebook"],
    ["m.facebook.com", null, "facebook"],
    ["android-app://com.facebook.katana", null, "facebook"],
    ["wa.me", null, "whatsapp"],
    ["api.whatsapp.com", null, "whatsapp"],
    ["web.whatsapp.com", null, "whatsapp"],
    ["www.tiktok.com", null, "tiktok"],
    ["android-app://com.zhiliaoapp.musically", null, "tiktok"],
    ["t.co", null, "x"],
    ["youtu.be", null, "youtube"],
    ["www.google.com", null, "google"],
    ["www.google.com.br", null, "google"],
    ["google.co.uk", null, "google"],
    ["www.bing.com", null, "search"],
    ["duckduckgo.com", null, "search"],
    ["blog.exemplo.com.br", null, "other"],
    ["android-app://com.exemplo.app", null, "other"],
    // The product's own host is not a source.
    ["projeto.test", null, "direct"],
    // Look-alike hosts are not the network.
    ["instagram.com.evil.example", null, "other"],
    ["notinstagram.com", null, "other"],
    ["evil.example/instagram.com", null, "other"],
    // In-app browsers often send no referrer: a recognized utm_source decides.
    ["", "instagram", "instagram"],
    ["", "ig", "instagram"],
    ["", "zap", "whatsapp"],
    ["blog.exemplo.com.br", "fb", "facebook"],
    ["", "newsletter", "direct"],
    // The referrer wins over a utm_source that says something else.
    ["l.instagram.com", "whatsapp", "instagram"],
    // Hostile strings.
    ["javascript:alert(1)", null, "direct"],
    ["<script>alert(1)</script>", null, "direct"],
    ["'; drop table analytics_events; --", null, "direct"],
    ["x".repeat(300), null, "direct"],
  ] as const)("%j with utm_source %j is %s", (referrer, utmSource, expected) => {
    expect(classifySource(referrer, utmSource, "projeto.test")).toBe(expected);
  });

  it("keeps only the host of an address: no path, query, port or credentials survive", () => {
    expect(referrerHost("https://user:pass@Blog.Exemplo.com.br:8443/a/b?token=segredo#x")).toBe("blog.exemplo.com.br");
    expect(referrerHost("exemplo.com.br/caminho?email=ana@exemplo.com")).toBe("exemplo.com.br");
    expect(referrerHost("localhost")).toBeNull();
    expect(referrerHost("192.168.0.1")).toBeNull();
    expect(referrerHost("")).toBeNull();
  });

  it("never returns anything outside the closed set", () => {
    for (const value of ["l.instagram.com", "x.y.z", "%00", "https://a.b/?q=1"]) expect(TRAFFIC_SOURCES).toContain(classifySource(value, null, null));
  });
});

describe("UTM values (mirror of private.analytics_utm_is_valid)", () => {
  it.each([
    ["instagram", "instagram"],
    [" Instagram ", "instagram"],
    ["Black Friday", "black-friday"],
    ["black+friday", "black-friday"],
    ["bio_link.v2", "bio_link.v2"],
    ["a".repeat(40), "a".repeat(40)],
    ["a".repeat(41), null],
    ["", null],
    [null, null],
    ["promoção", null],
    ["=cmd|' /C calc'!A0", null],
    ["<script>", null],
    ["a|b", null],
    ["a/b?c=1", null],
  ])("%j becomes %j", (input, expected) => expect(normalizeUtmValue(input)).toBe(expected));

  it("drops medium and campaign when there is no valid source", () => {
    expect(normalizeUtm({ source: "<x>", medium: "bio", campaign: "c" })).toEqual({ source: null, medium: null, campaign: null });
    expect(normalizeUtm({ source: "Instagram", medium: "Bio", campaign: "a b" })).toEqual({ source: "instagram", medium: "bio", campaign: "a-b" });
  });

  it("accepts exactly what the database accepts", () => {
    expect(MIGRATION).toContain("'^[a-z0-9_.-]{1,40}$'");
  });
});

describe("device class and automated traffic, from the user agent", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "mobile"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 334.0.4.32.98 (iPhone14,5; iOS 17_5; pt_BR)", "mobile"],
    ["Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 Instagram 334.0", "mobile"],
    ["Mozilla/5.0 (Linux; Android 13; CUBOT KingKong) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36", "mobile"],
    ["Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "tablet"],
    ["Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "tablet"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "desktop"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "desktop"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "desktop"],
    ["SomethingNew/1.0", "unknown"],
    ["", "unknown"],
    [null, "unknown"],
  ] as const)("%j is %s", (userAgent, expected) => expect(classifyDevice(userAgent)).toBe(expected));

  it.each([
    "",
    "WhatsApp/2.23.20.0 A",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "TelegramBot (like TwitterBot)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
    "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; moto g power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
    "Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0 Safari/537.36 PTST/240101",
    "curl/8.7.1",
    "python-requests/2.32.3",
    "node",
    "Go-http-client/2.0",
    "okhttp/4.12.0",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
  ])("treats %j as automated", (userAgent) => expect(isAutomatedUserAgent(userAgent)).toBe(true));

  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 334.0.4.32.98 (iPhone14,5; iOS 17_5; pt_BR)",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.38.107]",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview",
    "Mozilla/5.0 (Linux; Android 13; CUBOT KingKong) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  ])("treats %j as a person", (userAgent) => expect(isAutomatedUserAgent(userAgent)).toBe(false));

  it("reads the country header or answers unknown (the header is absent on the local stack)", () => {
    expect(normalizeCountry("BR")).toBe("BR");
    expect(normalizeCountry("br")).toBe("BR");
    for (const value of [null, undefined, "", "BRA", "B", "1A", "<b>"]) expect(normalizeCountry(value)).toBe("ZZ");
  });
});

describe("reporting days (mirror of private.analytics_local_day)", () => {
  it("assigns instants around São Paulo midnight and around UTC midnight to the right day", () => {
    expect(localDay(new Date("2026-10-03T02:59:00Z"), TZ)).toBe("2026-10-02"); // 23:59 local
    expect(localDay(new Date("2026-10-03T03:01:00Z"), TZ)).toBe("2026-10-03"); // 00:01 local
    expect(localDay(new Date("2026-10-02T23:59:00Z"), TZ)).toBe("2026-10-02");
    expect(localDay(new Date("2026-10-03T00:01:00Z"), TZ)).toBe("2026-10-02"); // the UTC date changed, the day did not
    expect(localDay(new Date("2026-10-03T00:01:00Z"), "UTC")).toBe("2026-10-03");
  });

  it("does calendar arithmetic across months, years and leap days", () => {
    expect(addDays("2026-10-02", -6)).toBe("2026-09-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-09-26", "2026-10-02")).toBe(6);
    expect(daysInWindow("2026-09-30", "2026-10-02")).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(daysInWindow("2026-10-02", "2026-10-01")).toEqual([]);
  });

  it("defines the presets as N days ending today, today included", () => {
    expect(periodWindow("today", "2026-10-02")).toEqual({ from: "2026-10-02", to: "2026-10-02" });
    expect(periodWindow("7d", "2026-10-02")).toEqual({ from: "2026-09-26", to: "2026-10-02" });
    expect(periodWindow("30d", "2026-10-02")).toEqual({ from: "2026-09-03", to: "2026-10-02" });
    expect(periodWindow("90d", "2026-10-02")).toEqual({ from: "2026-07-05", to: "2026-10-02" });
    expect(daysInWindow("2026-07-05", "2026-10-02")).toHaveLength(90);
  });

  it("validates days and period names", () => {
    for (const value of ["2026-10-02", "2028-02-29"]) expect(isDay(value)).toBe(true);
    for (const value of ["2026-02-30", "2026-13-01", "02/10/2026", "2026-10-2", "", null, 20261002]) expect(isDay(value)).toBe(false);
    expect(parsePeriod("30d")).toBe("30d");
    for (const value of ["365d", "", undefined, ["7d"], "../x"]) expect(parsePeriod(value)).toBe("7d");
    expect(periodIsAvailable("7d", 7)).toBe(true);
    expect(periodIsAvailable("30d", 7)).toBe(false);
    expect(periodIsAvailable("today", 0)).toBe(false);
    expect(formatDay("2026-10-02")).toBe("02/10/2026");
  });
});

describe("visitor hashes", () => {
  const SALT = "0123456789abcdef0123456789abcdef";
  const base = { ip: "203.0.113.7", userAgent: "Mozilla/5.0", slug: "ana-lima", day: "2026-10-02", salt: SALT };
  const hashes = analyticsVisitorHashes(base);

  it("are stable for the same person, page and day", () => {
    expect(hashes.visitor).toMatch(/^[0-9a-f]{32}$/);
    expect(hashes.client).toMatch(/^[0-9a-f]{32}$/);
    expect(analyticsVisitorHashes({ ...base })).toEqual(hashes);
  });

  it("change with the day, the address and the secret", () => {
    for (const other of [{ ...base, day: "2026-10-03" }, { ...base, ip: "203.0.113.8" }, { ...base, salt: `${SALT}x` }]) {
      const changed = analyticsVisitorHashes(other);
      expect(changed.visitor?.slice(0, 16)).not.toBe(hashes.visitor?.slice(0, 16));
      expect(changed.visitor?.slice(16)).not.toBe(hashes.visitor?.slice(16));
      expect(changed.client).not.toBe(hashes.client);
    }
  });

  it("give the same person unrelated visitor hashes on two pages, and one page-independent client hash", () => {
    const other = analyticsVisitorHashes({ ...base, slug: "outra-pagina" });
    expect(other.visitor?.slice(0, 16)).not.toBe(hashes.visitor?.slice(0, 16));
    expect(other.visitor?.slice(16)).not.toBe(hashes.visitor?.slice(16));
    expect(other.client).toBe(hashes.client);
  });

  it("keep the rate-limit half when only the user agent changes, so rotating it opens no new bucket", () => {
    const other = analyticsVisitorHashes({ ...base, userAgent: "Mozilla/5.1" });
    expect(other.visitor?.slice(0, 16)).toBe(hashes.visitor?.slice(0, 16));
    expect(other.visitor?.slice(16)).not.toBe(hashes.visitor?.slice(16));
    expect(other.client).toBe(hashes.client);
  });

  it("cannot be matched with each other or with the lead rate-limit hash of the same person", () => {
    expect(hashes.client).not.toContain(hashes.visitor?.slice(0, 16));
    expect(hashes.client?.slice(0, 16)).not.toBe(hashes.visitor?.slice(16));
    const lead = visitorHash(base.ip, SALT, new Date("2026-10-02T15:00:00Z"));
    for (const value of [hashes.visitor, hashes.client]) expect(value).not.toBe(lead);
  });

  it("are absent without an address or a usable salt, and never contain the address", () => {
    for (const other of [{ ...base, ip: null }, { ...base, ip: "  " }, { ...base, salt: undefined }, { ...base, salt: "short" }]) expect(analyticsVisitorHashes(other)).toEqual({ visitor: null, client: null });
    expect(JSON.stringify(hashes)).not.toContain("203.0");
  });
});

describe("attestation (mirror of private.analytics_signature_is_valid)", () => {
  // The same vector is signed by supabase/tests/database/140-analytics.test.sql.
  const SECRET = "test-analytics-signing-secret-0123456789";
  const payload = serializeIngestPayload({
    slug: "studio-dados", visitor: null, client: null,
    view: { source: "direct", device: "mobile", country: "ZZ", utm: { source: null, medium: null, campaign: null } },
    events: [{ id: EVENT, type: "page_view", blockId: null }],
  });

  it("serializes with a fixed key order and signs it like the database", () => {
    expect(payload).toBe('{"v":1,"slug":"studio-dados","visitor":null,"client":null,"view":{"source":"direct","device":"mobile","country":"ZZ","utm_source":null,"utm_medium":null,"utm_campaign":null},"events":[{"id":"e0000000-0000-4000-8000-000000000001","type":"page_view","block":null}]}');
    expect(signIngestPayload(payload, SECRET)).toBe("627bc7f51778e91d291b85981d5935056aafd7b4ec37c2b4764b3b59e87ba9da");
    expect(signIngestPayload(payload.replace("studio-dados", "outra-dados"), SECRET)).not.toBe(signIngestPayload(payload, SECRET));
  });

  it("is not configured without a secret of at least 32 characters", () => {
    expect(analyticsSigningSecret({})).toBeNull();
    expect(analyticsSigningSecret({ ANALYTICS_SIGNING_SECRET: "short" })).toBeNull();
    expect(analyticsSigningSecret({ ANALYTICS_SIGNING_SECRET: SECRET })).toBe(SECRET);
  });
});

describe("ingestion boundary", () => {
  const input: IngestInput = {
    body: JSON.stringify({ v: 1, s: "ana-lima", r: "https://l.instagram.com/?u=https%3A%2F%2Fexemplo.com%2Fa%3Ftoken%3Dsegredo", u: ["Promo", "Bio", "Primavera 2026"], e: [{ i: EVENT, t: "page_view" }, { i: "e0000000-0000-4000-8000-000000000002", t: "link_click", b: BLOCK }] }),
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148 Safari/604.1",
    ip: "203.0.113.7",
    country: "BR",
    signedIn: false,
    ownHost: "projeto.test",
    day: "2026-10-02",
    salt: "0123456789abcdef0123456789abcdef",
    signingSecret: "test-analytics-signing-secret-0123456789",
  };

  it("builds a signed payload with server-derived dimensions", () => {
    const prepared = prepareIngestion(input);
    if (!prepared.send) throw new Error("expected a payload");
    expect(JSON.parse(prepared.payload)).toEqual({
      v: 1, slug: "ana-lima", visitor: expect.stringMatching(/^[0-9a-f]{32}$/), client: expect.stringMatching(/^[0-9a-f]{32}$/),
      view: { source: "instagram", device: "mobile", country: "BR", utm_source: "promo", utm_medium: "bio", utm_campaign: "primavera-2026" },
      events: [{ id: EVENT, type: "page_view", block: null }, { id: "e0000000-0000-4000-8000-000000000002", type: "link_click", block: BLOCK }],
    });
    expect(prepared).toMatchObject({ events: 2, dropped: 0, hashed: true });
    expect(prepared.signature).toBe(signIngestPayload(prepared.payload, input.signingSecret ?? ""));
  });

  it("never lets the referrer address, its query string, the IP or the user agent reach the payload", () => {
    const prepared = prepareIngestion(input);
    if (!prepared.send) throw new Error("expected a payload");
    for (const secret of ["l.instagram.com", "exemplo.com", "token", "segredo", "203.0.113.7", "iPhone", "Mozilla"]) expect(prepared.payload).not.toContain(secret);
  });

  it.each([
    ["malformed JSON", { body: "{" }, "invalid"],
    ["wrong contract", { body: JSON.stringify({ v: 9, s: "ana", e: [] }) }, "invalid"],
    ["oversized body", { body: JSON.stringify({ v: 1, s: "ana-lima", junk: "x".repeat(5000), e: [{ i: EVENT, t: "page_view" }] }) }, "invalid"],
    ["a bot", { userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" }, "automated"],
    ["a link preview", { userAgent: "WhatsApp/2.23.20.0 A" }, "automated"],
    ["Lighthouse", { userAgent: "Mozilla/5.0 Chrome/126.0 Mobile Safari/537.36 Chrome-Lighthouse" }, "automated"],
    ["no user agent", { userAgent: null }, "automated"],
    ["a signed-in person", { signedIn: true }, "signed_in"],
    ["a visit that came from the app", { body: JSON.stringify({ v: 1, s: "ana-lima", a: true, e: [{ i: EVENT, t: "page_view" }] }) }, "app_referrer"],
    ["only malformed events", { body: JSON.stringify({ v: 1, s: "ana-lima", e: [{ i: "x", t: "page_view" }] }) }, "empty"],
    ["no signing secret", { signingSecret: null }, "not_configured"],
  ] as const)("drops %s", (_label, override, reason) => {
    expect(prepareIngestion({ ...input, ...override })).toEqual({ send: false, reason });
  });

  it("works without a salt or an address, only without a visitor hash", () => {
    for (const override of [{ salt: undefined }, { ip: null }]) {
      const prepared = prepareIngestion({ ...input, ...override });
      expect(prepared).toMatchObject({ send: true, hashed: false });
      if (prepared.send) expect(JSON.parse(prepared.payload)).toMatchObject({ visitor: null, client: null });
    }
  });

  it("falls back to unknown country and device when the platform headers are absent", () => {
    const prepared = prepareIngestion({ ...input, country: null, userAgent: "SomethingNew/1.0" });
    if (!prepared.send) throw new Error("expected a payload");
    expect(JSON.parse(prepared.payload).view).toMatchObject({ country: "ZZ", device: "unknown" });
  });

  it("recognizes a session cookie of the product, chunked or not", () => {
    expect(hasSessionCookie("sb-abcdefgh-auth-token=base64-xyz")).toBe(true);
    expect(hasSessionCookie("theme=dark; sb-127-auth-token.0=base64-xyz; sb-127-auth-token.1=abc")).toBe(true);
    for (const value of [null, "", "theme=dark", "sb-auth-token-fake=1", "xsb-abc-auth-token=1"]) expect(hasSessionCookie(value)).toBe(false);
  });

  it("reads the database's answer defensively", () => {
    expect(parseIngestOutcome({ status: "ok", accepted: 2, duplicate: 1, repeat: 0, rejected: 0, rate_limited: 3 })).toEqual({ status: "ok", accepted: 2, duplicate: 1, repeat: 0, rejected: 0, rateLimited: 3 });
    expect(parseIngestOutcome({ status: "forbidden" })).toMatchObject({ status: "forbidden", accepted: 0 });
    expect(parseIngestOutcome({ status: "shedding" }).status).toBe("shedding");
    for (const value of [null, "ok", { status: "weird" }, { status: "ok", accepted: "9" }]) expect(parseIngestOutcome(value).accepted).toBe(0);
    expect(parseIngestOutcome({ status: "weird" }).status).toBe("unavailable");
  });
});

describe("CSV of daily results", () => {
  const rows: DayRow[] = [
    { day: "2026-09-30", status: "before_collection", partial: false, visits: 0, interactions: 0, results: 0, counts: {} },
    { day: "2026-10-01", status: "zero", partial: false, visits: 0, interactions: 0, results: 0, counts: {} },
    { day: "2026-10-02", status: "data", partial: true, visits: 12, interactions: 5, results: 3, counts: { page_view: 12, link_click: 2, whatsapp_click: 2, form_submit: 1 } },
  ];
  const csv = analyticsToCsv(rows, TZ);
  const lines = csv.split("\r\n");

  it("has honest column names, one line per day and the timezone in every line", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]?.slice(1)).toBe("dia,fuso_horario,situacao_do_dia,visitas_estimadas,resultados,cliques_em_links,cliques_em_redes_sociais,cliques_no_whatsapp,copias_da_chave_pix,cliques_no_link_de_pagamento,envios_de_formulario,videos_ou_musicas_carregados");
    expect(lines).toHaveLength(5);
    expect(lines[3]).toBe('"2026-10-02","America/Sao_Paulo","com dados (dia em andamento)","12","3","2","0","2","0","0","1","0"');
  });

  it("writes zero for a day with no visits and nothing for a day before counting started", () => {
    expect(lines[2]).toBe('"2026-10-01","America/Sao_Paulo","sem visitas nem cliques","0","0","0","0","0","0","0","0","0"');
    expect(lines[1]).toBe('"2026-09-30","America/Sao_Paulo","antes do início da contagem","","","","","","","","",""');
  });

  it("neutralizes spreadsheet formulas (same escaping as the lead export)", () => {
    expect(analyticsToCsv(rows, "=cmd|' /C calc'!A0").split("\r\n")[1]).toContain(`"'=cmd|' /C calc'!A0"`);
  });

  it("contains no visitor-level column", () => {
    expect(lines[0]).not.toMatch(/hash|ip|visitante|referr|agente/i);
  });
});
