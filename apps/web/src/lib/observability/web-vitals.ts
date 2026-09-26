// Web Vitals reported by the public renderer (docs/OBSERVABILITY.md). The endpoint is anonymous,
// so the payload is reduced to an allowlist of short fields: no URL, no slug, no user agent, no id.
export const WEB_VITAL_NAMES = ["TTFB", "FCP", "LCP", "CLS", "INP"] as const;
export const WEB_VITAL_ROUTES = ["public_page"] as const;
export const WEB_VITALS_MAX_BODY_BYTES = 1024;

export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];
export type WebVitalRoute = (typeof WEB_VITAL_ROUTES)[number];

export interface WebVitalReport {
  name: WebVitalName;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  route: WebVitalRoute;
  navigationType: string;
}

const RATINGS = new Set(["good", "needs-improvement", "poor"]);
const NAVIGATION_TYPES = new Set(["navigate", "reload", "prerender", "back-forward", "back-forward-cache", "restore"]);

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** Returns a sanitized report or null. CLS is unitless; the others are milliseconds. */
export function parseWebVitalReport(input: unknown): WebVitalReport | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (!includes(WEB_VITAL_NAMES, body.name) || !includes(WEB_VITAL_ROUTES, body.route)) return null;
  if (typeof body.value !== "number" || !Number.isFinite(body.value) || body.value < 0) return null;
  if (body.value > (body.name === "CLS" ? 100 : 600_000)) return null;
  if (typeof body.rating !== "string" || !RATINGS.has(body.rating)) return null;
  const navigationType = typeof body.navigationType === "string" && NAVIGATION_TYPES.has(body.navigationType) ? body.navigationType : "other";
  const value = body.name === "CLS" ? Math.round(body.value * 1000) / 1000 : Math.round(body.value);
  return { name: body.name, value, rating: body.rating as WebVitalReport["rating"], route: body.route, navigationType };
}
