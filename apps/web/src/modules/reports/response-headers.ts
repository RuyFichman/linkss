/**
 * Response headers of /r/<token> (ADR 0013). next.config.ts applies them to every answer under
 * /r/, including the 404; a test pins them. The token is in the path, so the page must never be
 * stored by a shared cache, never be indexed, never be framed and never send its address to
 * another site. This file imports nothing, because next.config.ts loads it outside the bundler.
 */
export const REPORT_ROUTE_SOURCE = "/r/:path*";

export const REPORT_RESPONSE_HEADERS = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];
