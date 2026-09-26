import { logEvent } from "@/lib/observability/logger";
import { parseWebVitalReport, WEB_VITALS_MAX_BODY_BYTES } from "@/lib/observability/web-vitals";

/**
 * Receives Web Vitals beacons from public pages and turns them into structured logs. Always answers
 * 204 so the endpoint gives no feedback to probing; invalid or cross-site reports are dropped.
 * Rate limiting for anonymous endpoints is planned for Sprint 9 (docs/THREAT_MODEL.md).
 */
export async function POST(request: Request): Promise<Response> {
  const noContent = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return noContent;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > WEB_VITALS_MAX_BODY_BYTES) return noContent;

  let text: string;
  try {
    text = await request.text();
  } catch {
    return noContent;
  }
  if (text.length > WEB_VITALS_MAX_BODY_BYTES) return noContent;

  let report;
  try {
    report = parseWebVitalReport(JSON.parse(text));
  } catch {
    return noContent;
  }
  if (report) logEvent("info", "web_vital", { ...report });
  return noContent;
}
