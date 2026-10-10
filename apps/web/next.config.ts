import type { NextConfig } from "next";
import { siteSecurityHeaders } from "./src/lib/security/response-headers";
import { REPORT_RESPONSE_HEADERS, REPORT_ROUTE_SOURCE } from "./src/modules/reports/response-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Shared reports carry a secret in their address (ADR 0013): no shared cache, no index, no referrer.
  async headers() {
    return [
      { source: "/:path*", headers: siteSecurityHeaders(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NODE_ENV !== "production", process.env.NEXT_PUBLIC_MEDIA_BASE_URL) },
      { source: REPORT_ROUTE_SOURCE, headers: REPORT_RESPONSE_HEADERS },
    ];
  },
};

export default nextConfig;
