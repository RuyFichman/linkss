/**
 * Custom-domain hostnames (ADR 0016): the rules the application shares with the database
 * (private.domain_hostname_is_well_formed and private.domain_hostname_is_blocked). The database is
 * the authority; this mirror validates at the boundary and drives the screen.
 */

/** The TXT record that proves control lives at `_linkfav.<hostname>` and holds the challenge. */
export const DOMAIN_CHALLENGE_LABEL = "_linkfav";
export const DOMAIN_CHALLENGE_PATTERN = /^linkfav-verify=[0-9a-f]{32}$/;
export const HOSTNAME_MAX_LENGTH = 253;

const WELL_FORMED = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Mirror of private.domain_hostname_is_blocked. A suffix covers its subdomains. */
export const BLOCKED_HOSTNAME_SUFFIXES = [
  "linkfav.com", "vercel.app", "vercel.com", "vercel-dns.com", "now.sh", "supabase.co", "supabase.com",
  "localhost", "local", "internal", "invalid", "example", "example.com", "example.org", "example.net", "arpa",
] as const;

function hasSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

/**
 * What a person typed ("https://www.Loja.com.br/", "loja.com.br.") as a bare lowercase hostname.
 * Internationalized names become punycode, the form DNS and the database use. Returns "" when the
 * text is not a hostname at all; `validateHostname` decides whether the result is acceptable.
 */
export function normalizeHostname(value: string): string {
  const text = value.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  if (text === "" || /[\s@:\\]/.test(text)) return "";
  try {
    return new URL(`http://${text}`).hostname;
  } catch {
    return "";
  }
}

export type HostnameProblem = "empty" | "invalid" | "blocked";
export type HostnameValidation = { ok: true; hostname: string } | { ok: false; problem: HostnameProblem };

/**
 * `ownHosts` are the hostnames this deployment answers on (from NEXT_PUBLIC_APP_URL), which the
 * database cannot know: nobody attaches the product's own address to a page.
 */
export function validateHostname(value: unknown, ownHosts: readonly string[] = []): HostnameValidation {
  if (typeof value !== "string" || value.trim() === "") return { ok: false, problem: "empty" };
  const hostname = normalizeHostname(value);
  if (hostname.length < 4 || hostname.length > HOSTNAME_MAX_LENGTH || !WELL_FORMED.test(hostname)) return { ok: false, problem: "invalid" };
  if ([...BLOCKED_HOSTNAME_SUFFIXES, ...ownHosts].some((suffix) => suffix !== "" && hasSuffix(hostname, suffix))) return { ok: false, problem: "blocked" };
  return { ok: true, hostname };
}

/** True for a string already in the stored form. Used on values that arrive in a URL or a Host header. */
export function isStoredHostname(value: unknown): value is string {
  return typeof value === "string" && value.length >= 4 && value.length <= HOSTNAME_MAX_LENGTH && WELL_FORMED.test(value);
}

export function challengeRecordName(hostname: string): string {
  return `${DOMAIN_CHALLENGE_LABEL}.${hostname}`;
}

/** https only: the hosting provider issues the certificate before the domain answers. */
export function customDomainUrl(hostname: string): string {
  return `https://${hostname}`;
}
