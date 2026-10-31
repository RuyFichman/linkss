import type { Copy } from "@/content/copy";
import { SLUG_COPY as PORTUGUESE_SLUG_COPY } from "@/content/pt-BR";
import { RESERVED_SLUGS } from "./reserved-slugs";

export { RESERVED_SLUGS };

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

/** Statuses produced locally (validateSlug) and by the check_slug_availability RPC. */
export type SlugStatus = "empty" | "invalid" | "too-short" | "too-long" | "reserved" | "taken" | "held" | "available";
export interface SlugValidation { normalized: string; status: SlugStatus; message: string; valid: boolean; }

/** Address messages in one language (ADR 0022); Portuguese by default. */
export type SlugWords = Copy["SLUG_COPY"];

export function slugMessage(status: SlugStatus, normalized: string, words: SlugWords = PORTUGUESE_SLUG_COPY): string {
  switch (status) {
    case "too-short": return words.tooShort(SLUG_MIN_LENGTH);
    case "too-long": return words.tooLong(SLUG_MAX_LENGTH);
    case "available": return words.available(normalized);
    default: return words[status];
  }
}

/** Mirrors private.normalize_slug in supabase/migrations (parity checked in pgTAP and Vitest). */
export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function isReservedSlug(normalized: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(normalized);
}

function result(normalized: string, status: SlugStatus, words: SlugWords): SlugValidation {
  return { normalized, status, valid: status === "available", message: slugMessage(status, normalized, words) };
}

/** Local format check. `taken` supports the offline prototype; production asks the database. */
export function validateSlug(value: string, taken: readonly string[] = [], words: SlugWords = PORTUGUESE_SLUG_COPY): SlugValidation {
  const normalized = normalizeSlug(value);
  if (!normalized) return result(normalized, "empty", words);
  if (/[^a-z0-9-]/.test(normalized)) return result(normalized, "invalid", words);
  if (normalized.length < SLUG_MIN_LENGTH) return result(normalized, "too-short", words);
  if (normalized.length > SLUG_MAX_LENGTH) return result(normalized, "too-long", words);
  if (isReservedSlug(normalized)) return result(normalized, "reserved", words);
  if (taken.map(normalizeSlug).includes(normalized)) return result(normalized, "taken", words);
  return result(normalized, "available", words);
}

/** Maps the RPC status (invalid|reserved|taken|held|available) to the shared shape. */
export function fromAvailabilityStatus(normalized: string, status: string, words: SlugWords = PORTUGUESE_SLUG_COPY): SlugValidation {
  if (status === "available" || status === "reserved" || status === "taken" || status === "held") return result(normalized, status, words);
  const local = validateSlug(normalized, [], words);
  return local.valid ? result(normalized, "invalid", words) : local;
}
