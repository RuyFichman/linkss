import { createHmac } from "node:crypto";

/**
 * Daily visitor hash for visit deduplication and the per-visitor rate limit (ADR 0011). The IP
 * address and the user agent are inputs only and are never stored. The hash:
 * - changes every reporting day, so a person cannot be followed across days;
 * - includes the page address, so the same person has unrelated hashes on two pages;
 * - reuses VISITOR_HASH_SALT with its own message prefix, so it cannot be matched with the lead
 *   rate-limit hash (modules/leads/visitor-hash.ts) of the same person.
 */
export const ANALYTICS_HASH_LENGTH = 32;
const SALT_MIN_LENGTH = 16;
const MESSAGE_PREFIX = "analytics:v1";

export interface VisitorHashInput {
  ip: string | null | undefined;
  userAgent: string | null | undefined;
  slug: string;
  /** Reporting day (`YYYY-MM-DD`) of the request. */
  day: string;
  salt: string | null | undefined;
}

/** Hex hash, or null when there is no usable address or salt (the database then uses a shared bucket). */
export function analyticsVisitorHash({ ip, userAgent, slug, day, salt }: VisitorHashInput): string | null {
  const address = (ip ?? "").trim();
  if (!address || !salt || salt.length < SALT_MIN_LENGTH) return null;
  // Unit separators keep the fields from running into each other.
  const message = [MESSAGE_PREFIX, day, slug, address, userAgent ?? ""].join("\u001f");
  return createHmac("sha256", salt).update(message, "utf8").digest("hex").slice(0, ANALYTICS_HASH_LENGTH);
}
