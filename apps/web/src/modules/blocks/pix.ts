import { PIX_EMAIL_MAX_LENGTH } from "./limits";

/**
 * Pix keys (ADR 0010). The block shows the key for the payer to copy; the product never initiates,
 * confirms or stores a payment. Stored keys are normalized and re-validated on every read. Mirror
 * of private.is_valid_pix_key().
 */
export const PIX_KEY_TYPES = ["cpf", "cnpj", "phone", "email", "random"] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

export function isPixKeyType(value: unknown): value is PixKeyType {
  return typeof value === "string" && (PIX_KEY_TYPES as readonly string[]).includes(value);
}

function checkDigit(digits: string, weights: readonly number[]): number {
  const sum = weights.reduce((total, weight, index) => total + weight * Number(digits[index]), 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const first = checkDigit(value, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(value, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(value[9]) && second === Number(value[10]);
}

export function isValidCnpj(value: string): boolean {
  if (!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const first = checkDigit(value, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(value, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(value[12]) && second === Number(value[13]);
}

// "+55", a two-digit area code that does not start with 0, then 8 or 9 digits.
const PHONE_PATTERN = /^\+55[1-9]\d{9,10}$/;
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RANDOM_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True only for a key already in its stored (normalized) form. */
export function isValidPixKey(type: unknown, key: unknown): key is string {
  if (!isPixKeyType(type) || typeof key !== "string") return false;
  switch (type) {
    case "cpf": return isValidCpf(key);
    case "cnpj": return isValidCnpj(key);
    case "phone": return PHONE_PATTERN.test(key);
    case "email": return key.length <= PIX_EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(key);
    case "random": return RANDOM_PATTERN.test(key);
  }
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/** Stored form of what was typed for a given type, or null when it is not a valid key. */
export function normalizePixKey(type: PixKeyType, input: string): string | null {
  const trimmed = input.trim();
  let key: string;
  switch (type) {
    case "cpf":
    case "cnpj":
      // Only digits and the usual punctuation; letters mean it is something else.
      if (/[^\d.\-/\s]/.test(trimmed)) return null;
      key = digitsOf(trimmed);
      break;
    case "phone": {
      if (/[^\d+()\-.\s]/.test(trimmed)) return null;
      const digits = digitsOf(trimmed);
      key = trimmed.startsWith("+") ? `+${digits}` : digits.length === 12 || digits.length === 13 ? `+${digits}` : `+55${digits.replace(/^0/, "")}`;
      break;
    }
    case "email":
      key = trimmed.toLowerCase();
      break;
    case "random":
      key = trimmed.toLowerCase();
      break;
  }
  return isValidPixKey(type, key) ? key : null;
}

/**
 * Best guess of the key type from what was typed. Eleven digits are a CPF only when the check
 * digits match; otherwise they are read as a phone with area code.
 */
export function detectPixKeyType(input: string): PixKeyType | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) return normalizePixKey("email", trimmed) ? "email" : null;
  if (normalizePixKey("random", trimmed)) return "random";
  if (trimmed.startsWith("+")) return normalizePixKey("phone", trimmed) ? "phone" : null;
  if (normalizePixKey("cnpj", trimmed)) return "cnpj";
  if (normalizePixKey("cpf", trimmed)) return "cpf";
  if (normalizePixKey("phone", trimmed)) return "phone";
  return null;
}

/** How the key is shown on the page and in the editor; what is copied is always the stored key. */
export function formatPixKey(type: PixKeyType, key: string): string {
  switch (type) {
    case "cpf": return key.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
    case "cnpj": return key.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
    case "phone": return key.replace(/^\+55(\d{2})(\d{4,5})(\d{4})$/, "+55 ($1) $2-$3");
    default: return key;
  }
}
