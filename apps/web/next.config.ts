import type { NextConfig } from "next";
import { CAPTCHA_ROUTE_SOURCE, publicPageSource, siteSecurityHeaders } from "./src/lib/security/response-headers";
import { captchaSiteKey } from "./src/modules/identity/captcha";
import { customDomainRewrites, platformHostPattern } from "./src/modules/domains/routing";
import { RESERVED_SLUGS } from "./src/modules/profiles/reserved-slugs";
import { REPORT_RESPONSE_HEADERS, REPORT_ROUTE_SOURCE } from "./src/modules/reports/response-headers";

const appUrl = process.env.NEXT_PUBLIC_APP_URL;
const securityHeaders = (publicPage: boolean, captcha = false) =>
  siteSecurityHeaders(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NODE_ENV !== "production", process.env.NEXT_PUBLIC_MEDIA_BASE_URL, { publicPage, captcha });

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Shared reports carry a secret in their address (ADR 0013): no shared cache, no index, no referrer.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders(false) },
      // Published pages may load their owner's Meta Pixel / Google Analytics after consent (ADR 0017).
      // Later entries override earlier ones for the same header, so these two widen the policy only
      // for a public page at its product address and at the root of a custom hostname (ADR 0016).
      { source: publicPageSource(RESERVED_SLUGS), headers: securityHeaders(true) },
      { source: "/", missing: [{ type: "host", value: platformHostPattern(appUrl) }], headers: securityHeaders(true) },
      // The forms checked by Turnstile may load it, and only when this environment has a site key (ADR 0018).
      ...(captchaSiteKey() ? [{ source: CAPTCHA_ROUTE_SOURCE, headers: securityHeaders(false, true) }] : []),
      { source: REPORT_ROUTE_SOURCE, headers: REPORT_RESPONSE_HEADERS },
    ];
  },
  // A hostname that is not the product's own is a custom domain: its root opens the page it was
  // proven for and nothing else of the product is served there (ADR 0016).
  async rewrites() {
    return { beforeFiles: customDomainRewrites(appUrl), afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
