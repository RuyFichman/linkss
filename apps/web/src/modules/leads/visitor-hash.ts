import { createHmac } from "node:crypto";

/**
 * Rate-limit identifier for form submissions (ADR 0010). The raw IP address is never stored: the
 * database only sees an HMAC of it, keyed by a server secret and the UTC day, so the value cannot
 * be reversed without the secret, changes every day and is deleted from form_submission_hits
 * within 24 hours.
 */
export const VISITOR_HASH_LENGTH = 32;
const SALT_MIN_LENGTH = 16;

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Hex hash, or null when there is no usable address or salt (the database then uses a shared bucket). */
export function visitorHash(ip: string | null | undefined, salt: string | null | undefined, now: Date = new Date()): string | null {
  const address = (ip ?? "").trim();
  if (!address || !salt || salt.length < SALT_MIN_LENGTH) return null;
  return createHmac("sha256", salt).update(`${utcDay(now)}:${address}`, "utf8").digest("hex").slice(0, VISITOR_HASH_LENGTH);
}

/** First address of `x-forwarded-for` (the client as seen by the hosting platform's proxy). */
export function clientAddress(forwardedFor: string | null, realIp: string | null): string | null {
  const first = (forwardedFor ?? "").split(",")[0]?.trim();
  return first || realIp?.trim() || null;
}
