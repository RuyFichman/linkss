import type { NextConfig } from "next";
import { REPORT_RESPONSE_HEADERS, REPORT_ROUTE_SOURCE } from "./src/modules/reports/response-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Shared reports carry a secret in their address (ADR 0013): no shared cache, no index, no referrer.
  async headers() {
    return [{ source: REPORT_ROUTE_SOURCE, headers: REPORT_RESPONSE_HEADERS }];
  },
};

export default nextConfig;
