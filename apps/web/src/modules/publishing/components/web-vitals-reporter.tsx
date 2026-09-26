"use client";

import { useReportWebVitals } from "next/web-vitals";
import type { WebVitalRoute } from "@/lib/observability/web-vitals";

const ENDPOINT = "/api/vitals";

// Stable module-level callback: useReportWebVitals re-reports when the function identity changes.
function report(route: WebVitalRoute) {
  return (metric: { name: string; value: number; rating: string; navigationType: string }) => {
    const body = JSON.stringify({ name: metric.name, value: metric.value, rating: metric.rating, navigationType: metric.navigationType, route });
    try {
      // Fire-and-forget: failures never affect the visitor.
      if (!navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) {
        void fetch(ENDPOINT, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => undefined);
      }
    } catch {
      // Ignore: telemetry must not break the page.
    }
  };
}

const reportPublicPage = report("public_page");

export function PublicPageWebVitals() {
  useReportWebVitals(reportPublicPage);
  return null;
}
