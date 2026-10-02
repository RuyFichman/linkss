import { createHmac } from "node:crypto";

/**
 * Daily salted hashes of a visitor (ADR 0011). The IP address and the user agent are inputs only
 * and are never stored. Two values leave this module:
 *
 * - `visitor` (stored on events): 16 hex characters that depend on the page and the address, then
 *   16 that also depend on the user agent. The first half is the per-page rate-limit bucket, so
 *   changing the user agent does not open a new one; the whole value is the visit rule's key, so
 *   two devices behind one address are two visitors.
 * - `client` (stored only in the rate-limit counters, with no page): the address alone, for the
 *   limit across all pages.
 *
 * All of them change every reporting day, so nobody can be followed across days. `visitor`
 * includes the page address, so the same person has unrelated hashes on two pages, and none of the
 * values can be matched with the lead rate-limit hash (modules/leads/visitor-hash.ts): the salt is
 * shared, the message prefixes are not.
 */
export const ANALYTICS_HASH_LENGTH = 32;
const HALF = ANALYTICS_HASH_LENGTH / 2;
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

export interface VisitorHashes {
  visitor: string | null;
  client: string | null;
}

/** Null values when there is no usable address or salt (the database then uses shared buckets). */
export function analyticsVisitorHashes({ ip, userAgent, slug, day, salt }: VisitorHashInput): VisitorHashes {
  const address = (ip ?? "").trim();
  if (!address || !salt || salt.length < SALT_MIN_LENGTH) return { visitor: null, client: null };
  // Unit separators keep the fields from running into each other.
  const digest = (...parts: string[]) => createHmac("sha256", salt).update([MESSAGE_PREFIX, ...parts].join("\u001f"), "utf8").digest("hex");
  return {
    visitor: digest("page-address", day, slug, address).slice(0, HALF) + digest("page-device", day, slug, address, userAgent ?? "").slice(0, HALF),
    client: digest("address", day, address).slice(0, ANALYTICS_HASH_LENGTH),
  };
}
