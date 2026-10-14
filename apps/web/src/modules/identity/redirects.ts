export const DEFAULT_AFTER_SIGN_IN = "/app";

/** Internal destinations a `next` parameter may point to after authentication. */
const ALLOWED_PREFIXES = ["/app", "/redefinir-senha"] as const;
const DUMMY_ORIGIN = "https://lnk.invalid";

/**
 * Returns a safe same-origin path or the fallback. Rejects absolute and protocol-relative URLs,
 * backslashes, control characters, encoded separators and anything outside the allowlist, so a
 * crafted link can never turn sign-in into an open redirect.
 */
/**
 * Where an e-mail confirmation link leads (ADR 0012, addendum). The confirmation template carries
 * `redirect_to`, the address the sign-up asked for (`/auth/confirm?next=<invitation>`), so a
 * person who signs up from an invitation on the phone and confirms on the laptop still lands on
 * the invitation. Only this application's own `/auth/confirm` is read, and the `next` inside it
 * passes the same allowlist as any other; a `redirect_to` that Auth replaced with the bare site
 * address, or one from elsewhere, is ignored.
 */
export function emailLinkNextPath(next: string | null, redirectTo: string | null, appOrigin: string): string {
  if (redirectTo && redirectTo.length <= 1024) {
    try {
      const url = new URL(redirectTo);
      const inner = url.origin === appOrigin && url.pathname === "/auth/confirm" ? url.searchParams.get("next") : null;
      if (inner) return safeNextPath(inner);
    } catch {
      // Not an address: fall back to `next`.
    }
  }
  return safeNextPath(next);
}

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
