import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "../same-origin";
import { readLimitedText } from "./limited-body";
import { contentSecurityPolicy, siteSecurityHeaders } from "./response-headers";

describe("bounded anonymous request body", () => {
  it("accepts the exact byte limit and rejects an extra byte without a Content-Length header", async () => {
    const exact = new Request("https://lnk.test/api/events", { method: "POST", body: "áa", duplex: "half" } as RequestInit);
    expect(await readLimitedText(exact, 3)).toBe("áa");
    const oversized = new Request("https://lnk.test/api/events", { method: "POST", body: "áa", duplex: "half" } as RequestInit);
    expect(await readLimitedText(oversized, 2)).toBeNull();
  });

  it("rejects invalid UTF-8 instead of parsing replacement characters", async () => {
    const request = new Request("https://lnk.test/api/events", { method: "POST", body: new Uint8Array([0xff]) });
    expect(await readLimitedText(request, 4)).toBeNull();
  });
});

describe("browser security headers", () => {
  it("allows only the configured Supabase origin and three embed providers", () => {
    const policy = contentSecurityPolicy("https://project.supabase.co/path", false, "https://media.example.test/bucket");
    expect(policy).toContain("connect-src 'self' https://project.supabase.co");
    expect(policy).toContain("img-src 'self' data: blob: https://project.supabase.co https://media.example.test");
    expect(policy).toContain("frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://open.spotify.com");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("evil.example");
  });

  it("ignores malformed or non-local HTTP configuration and keeps a restrictive base", () => {
    const policy = contentSecurityPolicy("http://evil.example", false);
    expect(policy).toContain("connect-src 'self';");
    expect(policy).not.toContain("evil.example");
    expect(siteSecurityHeaders(undefined, false)).toEqual(expect.arrayContaining([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
    ]));
  });

  it("allows development tooling only in development", () => {
    expect(contentSecurityPolicy("http://127.0.0.1:54321", true)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy("http://127.0.0.1:54321", true)).toContain("ws://localhost:*");
  });
});

describe("route-handler CSRF origin", () => {
  it("requires a matching scheme as well as host", () => {
    expect(isSameOriginRequest(new Headers({ origin: "https://lnk.example", host: "lnk.example" }))).toBe(true);
    expect(isSameOriginRequest(new Headers({ origin: "http://lnk.example", host: "lnk.example" }))).toBe(false);
    expect(isSameOriginRequest(new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(isSameOriginRequest(new Headers({ origin: "https://lnk.example", host: "internal:3000", "x-forwarded-host": "lnk.example", "x-forwarded-proto": "https" }))).toBe(true);
    expect(isSameOriginRequest(new Headers({ origin: "https://lnk.example/path", host: "lnk.example" }))).toBe(false);
  });
});
