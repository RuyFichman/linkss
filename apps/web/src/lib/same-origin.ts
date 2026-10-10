import { createHash, timingSafeEqual } from "node:crypto";

/**
 * CSRF guard for Route Handlers that act on a session cookie. Server Actions get this check from
 * Next.js; a plain route handler has to do it itself. The browser's Origin must match the public
 * host and scheme (as forwarded by the hosting proxy). A request without Origin is refused.
 */
export function isSameOriginRequest(headers: Pick<Headers, "get">): boolean {
  const origin = headers.get("origin");
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]?.trim().toLowerCase();
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    const forwardedProtocol = (headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim().toLowerCase();
    const expectedProtocol = forwardedProtocol || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
    return parsed.host.toLowerCase() === host
      && parsed.protocol === expectedProtocol + ":"
      && parsed.pathname === "/"
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}

/** Compares two secrets in constant time (digests make the lengths equal). */
export function secretsMatch(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}
