import { normalizeSlug, SLUG_MAX_LENGTH, SLUG_MIN_LENGTH } from "@/modules/profiles/slug";

export type RouteSlug =
  | { kind: "canonical"; slug: string }
  | { kind: "redirect"; slug: string }
  | { kind: "invalid" };

const WELL_FORMED = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Interprets the `[slug]` segment of a public URL. Non-canonical spellings ("Ana-Lima", "café")
 * redirect to the canonical address; anything that can never be a slug (favicon.ico, long junk)
 * is rejected without touching the database.
 */
export function resolveRouteSlug(segment: string): RouteSlug {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return { kind: "invalid" };
  }
  if (decoded.length > SLUG_MAX_LENGTH * 4) return { kind: "invalid" };
  const slug = normalizeSlug(decoded);
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH || !WELL_FORMED.test(slug)) return { kind: "invalid" };
  return slug === decoded ? { kind: "canonical", slug } : { kind: "redirect", slug };
}
