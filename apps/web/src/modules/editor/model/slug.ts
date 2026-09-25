export const RESERVED_SLUGS = ["admin", "api", "app", "login", "logout", "proto", "p", "r", "suporte", "privacidade", "agencias", "profissionais"] as const;

export type SlugStatus = "empty" | "invalid" | "too-short" | "too-long" | "reserved" | "taken" | "available";
export interface SlugValidation { normalized: string; status: SlugStatus; message: string; valid: boolean; }

export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function validateSlug(value: string, taken: readonly string[] = []): SlugValidation {
  const normalized = normalizeSlug(value);
  if (!normalized) return { normalized, status: "empty", valid: false, message: "Escolha o endereço da sua página." };
  if (/[^a-z0-9-]/.test(normalized)) return { normalized, status: "invalid", valid: false, message: "Use apenas letras, números e hífens." };
  if (normalized.length < 3) return { normalized, status: "too-short", valid: false, message: "Use pelo menos 3 caracteres." };
  if (normalized.length > 40) return { normalized, status: "too-long", valid: false, message: "Use no máximo 40 caracteres." };
  if ((RESERVED_SLUGS as readonly string[]).includes(normalized)) return { normalized, status: "reserved", valid: false, message: "Este endereço é reservado. Tente acrescentar seu nome ou cidade." };
  if (taken.map(normalizeSlug).includes(normalized)) return { normalized, status: "taken", valid: false, message: "Este endereço já está em uso. Tente acrescentar sua cidade ou especialidade." };
  return { normalized, status: "available", valid: true, message: `Ótimo — ${normalized} está disponível no protótipo.` };
}
