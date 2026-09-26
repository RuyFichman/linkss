/**
 * Absolute application origin for links sent by email and for canonical/Open Graph URLs. Taken
 * from configuration, never from the request Host header, so a spoofed host cannot redirect
 * confirmation links or poison cached public pages. Set NEXT_PUBLIC_APP_URL per environment; the
 * public domain only has to change here.
 */
export function appUrl(path = ""): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path}`;
}

/** Absolute URL of a public page. */
export function publicPageUrl(slug: string): string {
  return appUrl(`/${slug}`);
}

/** Human-readable public address without the scheme, e.g. "exemplo.com.br/ana-lima". */
export function publicAddressLabel(slug: string): string {
  return publicPageUrl(slug).replace(/^https?:\/\//, "");
}
