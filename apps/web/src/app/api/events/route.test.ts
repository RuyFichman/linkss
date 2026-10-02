import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ingest, pending } = vi.hoisted(() => ({ ingest: vi.fn(), pending: [] as Array<Promise<unknown>> }));
// `after` runs its callback once the response is sent; here it is collected so a test can wait for it.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (callback: () => Promise<unknown>) => { pending.push(callback()); } }));
vi.mock("@/modules/analytics/ingest-server", () => ({ createSupabaseIngestRepository: () => ({ ingest }) }));

const { POST } = await import("./route");

const SECRET = "test-analytics-signing-secret-0123456789";
const EVENT = "e0000000-0000-4000-8000-000000000001";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const batch = { v: 1, s: "ana-lima", r: "l.instagram.com", e: [{ i: EVENT, t: "page_view" }] };

function call(body: string, headers: Record<string, string> = {}) {
  return POST(new Request("https://projeto.test/api/events", {
    method: "POST", body,
    headers: { "content-type": "text/plain;charset=UTF-8", "content-length": String(new TextEncoder().encode(body).length), "user-agent": PHONE, "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.7", ...headers },
  }));
}

async function settled() {
  await Promise.all(pending.splice(0));
}

function logged(): Array<Record<string, unknown>> {
  const lines = [console.info, console.warn, console.error].flatMap((sink) => vi.mocked(sink).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>));
  return lines.filter((line) => line.event === "analytics.ingest");
}

describe("POST /api/events", () => {
  beforeEach(() => {
    vi.stubEnv("ANALYTICS_SIGNING_SECRET", SECRET);
    vi.stubEnv("VISITOR_HASH_SALT", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://projeto.test");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ingest.mockReset().mockResolvedValue({ status: "ok", accepted: 1, duplicate: 0, repeat: 0, rejected: 0, rateLimited: 0 });
    pending.length = 0;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers 204 with no body and stores a valid batch after the response", async () => {
    const response = await call(JSON.stringify(batch), { "x-vercel-ip-country": "BR" });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBeNull();
    await settled();
    expect(ingest).toHaveBeenCalledTimes(1);
    const [payload, signature] = ingest.mock.calls[0] as [string, string];
    expect(JSON.parse(payload)).toMatchObject({ v: 1, slug: "ana-lima", view: { source: "instagram", device: "mobile", country: "BR" }, events: [{ id: EVENT, type: "page_view", block: null }] });
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers before the database does", async () => {
    let release: (value: unknown) => void = () => undefined;
    ingest.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const response = await call(JSON.stringify(batch));
    expect(response.status).toBe(204);
    expect(pending).toHaveLength(1);
    release({ status: "ok", accepted: 1, duplicate: 0, repeat: 0, rejected: 0, rateLimited: 0 });
    await settled();
  });

  it("still answers 204 when the database is down, and logs the batch as lost", async () => {
    ingest.mockRejectedValue(new Error("Analytics ingestion failed: 08006"));
    const response = await call(JSON.stringify(batch));
    expect(response.status).toBe(204);
    await settled();
    expect(logged().at(-1)).toMatchObject({ level: "error", outcome: "unavailable", events: 1, accepted: 0 });
  });

  it("uses the local stack's defaults when the platform headers are absent", async () => {
    await call(JSON.stringify(batch), { "x-forwarded-for": "" });
    await settled();
    const [payload] = ingest.mock.calls[0] as [string];
    expect(JSON.parse(payload)).toMatchObject({ visitor: null, view: { country: "ZZ" } });
  });

  it.each([
    ["malformed JSON", "{", {}],
    ["an unknown contract version", JSON.stringify({ ...batch, v: 2 }), {}],
    ["an oversized body", JSON.stringify({ ...batch, junk: "x".repeat(5000) }), {}],
    ["a lying content-length", JSON.stringify(batch), { "content-length": "999999" }],
    ["a form content type", JSON.stringify(batch), { "content-type": "application/x-www-form-urlencoded" }],
    ["no content type", JSON.stringify(batch), { "content-type": "" }],
    ["a cross-site request", JSON.stringify(batch), { "sec-fetch-site": "cross-site" }],
    ["a bot", JSON.stringify(batch), { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }],
    ["a link-preview fetcher", JSON.stringify(batch), { "user-agent": "facebookexternalhit/1.1" }],
    ["a signed-in person (the owner looking at the page)", JSON.stringify(batch), { cookie: "sb-abcd-auth-token.0=base64-xyz" }],
    ["a visit that came from the editor", JSON.stringify({ ...batch, a: true }), {}],
  ])("answers 204 and stores nothing for %s", async (_label, body, headers) => {
    const response = await call(body, headers);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    await settled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it("drops events without failing when the signing secret is not deployed yet", async () => {
    vi.stubEnv("ANALYTICS_SIGNING_SECRET", "");
    const response = await call(JSON.stringify(batch));
    expect(response.status).toBe(204);
    await settled();
    expect(ingest).not.toHaveBeenCalled();
    expect(logged().at(-1)).toMatchObject({ outcome: "not_configured" });
  });

  it("reports a missing migration as not_deployed, still with 204", async () => {
    ingest.mockResolvedValue({ status: "not_deployed", accepted: 0, duplicate: 0, repeat: 0, rejected: 0, rateLimited: 0 });
    expect((await call(JSON.stringify(batch))).status).toBe(204);
    await settled();
    expect(logged().at(-1)).toMatchObject({ level: "warn", outcome: "not_deployed" });
  });

  it("logs counts and never the payload, the hash, the referrer, the address or the user agent", async () => {
    await call(JSON.stringify({ ...batch, u: ["segredo-utm", "", ""] }), { "x-vercel-ip-country": "BR" });
    await settled();
    const line = JSON.stringify(logged());
    expect(logged().at(-1)).toMatchObject({ outcome: "ok", events: 1, accepted: 1, hashed: true });
    const [payload] = ingest.mock.calls[0] as [string];
    const visitor = (JSON.parse(payload) as { visitor: string }).visitor;
    for (const secret of [visitor, "instagram", "203.0.113.7", "iPhone", "ana-lima", "segredo-utm", EVENT]) expect(line).not.toContain(secret);
  });
});
