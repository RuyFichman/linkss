export const DEFAULT_AFTER_SIGN_IN = "/app";

/** Internal destinations a `next` parameter may point to after authentication. */
const ALLOWED_PREFIXES = ["/app", "/redefinir-senha"] as const;
const DUMMY_ORIGIN = "https://lnk.invalid";

/**
 * Returns a safe same-origin path or the fallback. Rejects absolute and protocol-relative URLs,
 * backslashes, control characters, encoded separators and anything outside the allowlist, so a
 * crafted link can never turn sign-in into an open redirect.
 */
export function safeNextPath(value: string | null | undefined, fallback: string = DEFAULT_AFTER_SIGN_IN): string {
  if (!value || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (/%2f|%5c|%00/i.test(value)) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(value, DUMMY_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== DUMMY_ORIGIN) return fallback;

  const allowed = ALLOWED_PREFIXES.some((prefix) => parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`));
  if (!allowed) return fallback;
  return `${parsed.pathname}${parsed.search}`;
}
