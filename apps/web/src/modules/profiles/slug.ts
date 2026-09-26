import { RESERVED_SLUGS } from "./reserved-slugs";

export { RESERVED_SLUGS };

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

/** Statuses produced locally (validateSlug) and by the check_slug_availability RPC. */
export type SlugStatus = "empty" | "invalid" | "too-short" | "too-long" | "reserved" | "taken" | "held" | "available";
export interface SlugValidation { normalized: string; status: SlugStatus; message: string; valid: boolean; }

const SLUG_MESSAGES: Record<SlugStatus, (normalized: string) => string> = {
  empty: () => "Escolha o endereço da sua página.",
  invalid: () => "Use apenas letras, números e hífens.",
  "too-short": () => `Use pelo menos ${SLUG_MIN_LENGTH} caracteres.`,
  "too-long": () => `Use no máximo ${SLUG_MAX_LENGTH} caracteres.`,
  reserved: () => "Este endereço é reservado. Tente acrescentar seu nome ou cidade.",
  taken: () => "Este endereço já está em uso. Tente acrescentar sua cidade ou especialidade.",
  held: () => "Este endereço foi usado recentemente e ainda está protegido. Tente outra variação.",
  available: (normalized) => `Ótimo — ${normalized} está disponível.`,
};

export function slugMessage(status: SlugStatus, normalized: string): string {
  return SLUG_MESSAGES[status](normalized);
}

/** Mirrors private.normalize_slug in supabase/migrations (parity checked in pgTAP and Vitest). */
export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function isReservedSlug(normalized: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(normalized);
}

function result(normalized: string, status: SlugStatus): SlugValidation {
  return { normalized, status, valid: status === "available", message: slugMessage(status, normalized) };
}

/** Local format check. `taken` supports the offline prototype; production asks the database. */
export function validateSlug(value: string, taken: readonly string[] = []): SlugValidation {
  const normalized = normalizeSlug(value);
  if (!normalized) return result(normalized, "empty");
  if (/[^a-z0-9-]/.test(normalized)) return result(normalized, "invalid");
  if (normalized.length < SLUG_MIN_LENGTH) return result(normalized, "too-short");
  if (normalized.length > SLUG_MAX_LENGTH) return result(normalized, "too-long");
  if (isReservedSlug(normalized)) return result(normalized, "reserved");
  if (taken.map(normalizeSlug).includes(normalized)) return result(normalized, "taken");
  return result(normalized, "available");
}

/** Maps the RPC status (invalid|reserved|taken|held|available) to the shared shape. */
export function fromAvailabilityStatus(normalized: string, status: string): SlugValidation {
  if (status === "available" || status === "reserved" || status === "taken" || status === "held") return result(normalized, status);
  const local = validateSlug(normalized);
  return local.valid ? result(normalized, "invalid") : local;
}
