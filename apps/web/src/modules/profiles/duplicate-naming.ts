import { TITLE_MAX_LENGTH } from "./content";
import { isReservedSlug, normalizeSlug, SLUG_MAX_LENGTH } from "./slug";

const TITLE_PREFIX = "Cópia de ";
const SLUG_SUFFIX = "-copia";
const MAX_ATTEMPTS = 50;

/** "Cópia de <name>", cut to the name limit without splitting a character. */
export function copyTitle(title: string): string {
  const base = title.trim().replace(/\s+/g, " ");
  return [...`${TITLE_PREFIX}${base}`].slice(0, TITLE_MAX_LENGTH).join("").trim();
}

function withSuffix(slug: string, suffix: string): string {
  const room = SLUG_MAX_LENGTH - suffix.length;
  return `${slug.slice(0, room).replace(/-+$/, "")}${suffix}`;
}

/**
 * Suggested address for a copy: "<slug>-copia", then "-copia-2", "-copia-3"…, always within the
 * length limit and never one of `taken` or a reserved word. Only a suggestion: the person can
 * change it and the database decides availability across all workspaces.
 */
export function copySlug(slug: string, taken: readonly string[] = []): string {
  const base = normalizeSlug(slug);
  const used = new Set(taken.map(normalizeSlug));
  let candidate = withSuffix(base, SLUG_SUFFIX);
  for (let attempt = 2; attempt <= MAX_ATTEMPTS && (used.has(candidate) || isReservedSlug(candidate)); attempt += 1) {
    candidate = withSuffix(base, `${SLUG_SUFFIX}-${attempt}`);
  }
  return candidate;
}
