import { URL_MAX_LENGTH } from "./limits";

/**
 * Link destination policy (ADR 0008). TypeScript source of truth, mirrored by
 * private.is_allowed_block_url() in supabase/migrations; both run the same malicious-input table.
 *
 * Allowed: https, http (kept, not upgraded), mailto, tel. Bare domains get https://. Everything
 * else is refused, including obfuscated variants of dangerous schemes.
 */
export type UrlRejection = "required" | "scheme" | "relative" | "whitespace" | "credentials" | "host" | "email" | "phone" | "too_long";

export type UrlPolicyResult =
  | { ok: true; url: string; kind: "web" | "email" | "phone"; insecure: boolean; punycode: boolean }
  | { ok: false; reason: UrlRejection };

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
/** Schemes refused even when they look like "host:port" (e.g. "javascript:1"). */
const DANGEROUS_SCHEMES = new Set(["javascript", "data", "vbscript", "file", "blob", "about", "intent", "livescript", "mocha", "jar", "view-source", "filesystem", "ms-its", "mhtml"]);
const SCHEME_PATTERN = /^([a-z][a-z\d+.-]*):/i;
// Whitespace, C0/C1 controls, zero-width and bidi-control characters.
const INVISIBLE_PATTERN = /[\s\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/u;
const INVISIBLE_GLOBAL = new RegExp(INVISIBLE_PATTERN.source, "gu");
/** Dotted host with an alphabetic or punycode top-level label; mirrors the SQL pattern. */
export const WEB_HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const EMAIL_PATTERN = /^([^@/?#\s]+)@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59}))$/i;
const TEL_PATTERN = /^\+?\d{3,20}$/;
const TEL_PUNCTUATION = /[\s().-]/g;

const NAMED_ENTITIES: Record<string, string> = { colon: ":", tab: "\t", newline: "\n", nbsp: " ", sol: "/", period: "." };

/** Undoes common obfuscation so the scheme can be judged: entities, percent-encoding, invisibles. */
function deobfuscate(value: string): string {
  let current = value;
  for (let round = 0; round < 3; round += 1) {
    const previous = current;
    current = current
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16) % 0x110000))
      .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10) % 0x110000))
      .replace(/&([a-z]+);/gi, (entity, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? entity)
      .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(INVISIBLE_GLOBAL, "");
    if (current === previous) break;
  }
  return current.toLowerCase();
}

/** The scheme the input declares, or null for a bare host (including "host:port"). */
function declaredScheme(value: string): string | null {
  const match = SCHEME_PATTERN.exec(value);
  if (!match) return null;
  const scheme = (match[1] ?? "").toLowerCase();
  if (DANGEROUS_SCHEMES.has(scheme) || ALLOWED_SCHEMES.has(scheme)) return scheme;
  // "exemplo.com.br:8080/x" or "localhost:3000" is a host with a port, not a scheme.
  if (/^[^:]+:\d{1,5}(?:[/?#]|$)/.test(value)) return null;
  return scheme;
}

function normalizeWeb(candidate: string): UrlPolicyResult {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: "host" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, reason: "scheme" };
  if (parsed.username || parsed.password) return { ok: false, reason: "credentials" };
  if (!WEB_HOST_PATTERN.test(parsed.hostname)) return { ok: false, reason: "host" };
  const url = parsed.href;
  if (url.length > URL_MAX_LENGTH || INVISIBLE_PATTERN.test(url)) return { ok: false, reason: url.length > URL_MAX_LENGTH ? "too_long" : "whitespace" };
  return { ok: true, url, kind: "web", insecure: parsed.protocol === "http:", punycode: parsed.hostname.split(".").some((label) => label.startsWith("xn--")) };
}

/** Percent-encodes anything outside printable ASCII: stored destinations are always ASCII. */
function encodeNonAscii(value: string): string {
  return value.replace(/[^!-~]/gu, (character) => encodeURIComponent(character));
}

function normalizeEmail(rest: string): UrlPolicyResult {
  const [address = "", ...query] = encodeNonAscii(rest).split("?");
  const match = EMAIL_PATTERN.exec(address);
  if (!match) return { ok: false, reason: "email" };
  const url = `mailto:${match[1]}@${(match[2] ?? "").toLowerCase()}${query.length > 0 ? `?${query.join("?")}` : ""}`;
  return url.length > URL_MAX_LENGTH ? { ok: false, reason: "too_long" } : { ok: true, url, kind: "email", insecure: false, punycode: false };
}

function normalizePhone(rest: string): UrlPolicyResult {
  const digits = rest.replace(TEL_PUNCTUATION, "");
  return TEL_PATTERN.test(digits) ? { ok: true, url: `tel:${digits}`, kind: "phone", insecure: false, punycode: false } : { ok: false, reason: "phone" };
}

/** Normalizes what a person typed into the stored destination, or explains why it is refused. */
export function normalizeBlockUrl(input: string): UrlPolicyResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "required" };
  if (trimmed.length > URL_MAX_LENGTH) return { ok: false, reason: "too_long" };

  // Judge the scheme on the deobfuscated text first: "java\tscript:", "%6Aavascript:" and
  // "&#106;avascript:" all count as javascript:.
  const hidden = declaredScheme(deobfuscate(trimmed));
  if (hidden !== null && !ALLOWED_SCHEMES.has(hidden)) return { ok: false, reason: "scheme" };

  const scheme = declaredScheme(trimmed);
  if (scheme === "tel") return normalizePhone(trimmed.slice(4));
  if (INVISIBLE_PATTERN.test(trimmed)) return { ok: false, reason: "whitespace" };
  if (scheme === null) {
    if (/^[/\\.?#]/.test(trimmed)) return { ok: false, reason: "relative" };
    return normalizeWeb(`https://${trimmed}`);
  }
  if (scheme === "mailto") return normalizeEmail(trimmed.slice(7));
  if (scheme === "http" || scheme === "https") {
    // Require the authority form ("https://host"); "https:host" is a typo we do not guess.
    if (!/^https?:\/\/[^/]/i.test(trimmed)) return { ok: false, reason: "host" };
    return normalizeWeb(trimmed);
  }
  return { ok: false, reason: "scheme" };
}

/** True only for a destination already in its stored (normalized) form. Used on every read. */
export function isAllowedStoredUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^[!-~]+$/.test(value)) return false;
  const result = normalizeBlockUrl(value);
  return result.ok && result.url === value;
}
