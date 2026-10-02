import { createHash, timingSafeEqual } from "node:crypto";

/**
 * CSRF guard for Route Handlers that act on a session cookie. Server Actions get this check from
 * Next.js; a plain route handler has to do it itself. The browser's `Origin` header must name the
 * host this request was sent to (as forwarded by the hosting proxy). A request without `Origin`
 * is refused: every browser sends it on POST.
 */
export function isSameOriginRequest(headers: Pick<Headers, "get">): boolean {
  const origin = headers.get("origin");
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]?.trim().toLowerCase();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/** Compares two secrets in constant time (digests make the lengths equal). */
export function secretsMatch(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}
