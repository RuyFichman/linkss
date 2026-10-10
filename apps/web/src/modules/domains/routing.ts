/**
 * How a request for a custom hostname reaches its page (ADR 0016). Pure configuration for
 * next.config.ts: no request ever runs code from this file.
 *
 * A hostname that is not one of the product's own is a custom domain. Its root is rewritten to the
 * internal route `/d/<hostname>`, which asks the database which page (if any) that hostname opens.
 * Every other path on a custom hostname is a 404, except the few the public page itself needs:
 * the product (sign-in, the app, reports, the API) is never served under a customer's domain.
 */
export const CUSTOM_DOMAIN_ROUTE = "/d";

/** Paths a public page requests from its own origin: build assets, the two beacons and the icon. */
const PUBLIC_PAGE_PATHS = ["_next/", "api/events$", "api/vitals$", "icon\\.svg$", "favicon\\.ico$"];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regular expression (as text, matched against the whole Host without its port) of the hostnames
 * that are the product itself: the configured public host with and without "www", the hosting
 * provider's deployment addresses, and local addresses.
 */
export function platformHostPattern(appUrl: string | undefined): string {
  const hosts = ["localhost", "127\\.0\\.0\\.1", "\\[::1\\]", ".+\\.vercel\\.app"];
  try {
    const host = new URL(appUrl ?? "").hostname.toLowerCase().replace(/^www\./, "");
    if (host && host !== "localhost" && host !== "127.0.0.1") hosts.push(`(www\\.)?${escapeRegex(host)}`);
  } catch {
    // No public URL configured: only the defaults above are the product.
  }
  return `(${hosts.join("|")})`;
}

type HostCondition = { type: "host"; value: string };
export interface HostRewrite {
  source: string;
  destination: string;
  has: HostCondition[];
  missing: HostCondition[];
}

/**
 * `beforeFiles` rewrites: they must win over every page, including the marketing home at "/".
 *
 * Order matters. Next.js keeps applying the following `beforeFiles` entries to the path an earlier
 * one produced, so the catch-all comes first: it cannot match "/", and the root rule that follows
 * cannot match what the catch-all produced. The other way round, the root's own destination would
 * be caught and every custom domain would answer 404 (found by scripts/domains-lifecycle.mjs).
 */
export function customDomainRewrites(appUrl: string | undefined): HostRewrite[] {
  const has: HostCondition[] = [{ type: "host", value: "(?<host>.+)" }];
  const missing: HostCondition[] = [{ type: "host", value: platformHostPattern(appUrl) }];
  return [
    // No route exists three segments deep under /d, so this is the application's 404.
    { source: `/:path((?!${PUBLIC_PAGE_PATHS.join("|")}).+)`, has, missing, destination: `${CUSTOM_DOMAIN_ROUTE}/:host/unavailable` },
    { source: "/", has, missing, destination: `${CUSTOM_DOMAIN_ROUTE}/:host` },
  ];
}
