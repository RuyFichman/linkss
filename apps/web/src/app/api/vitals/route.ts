import { logEvent } from "@/lib/observability/logger";
import { readLimitedText } from "@/lib/security/limited-body";
import { parseWebVitalReport, WEB_VITALS_MAX_BODY_BYTES } from "@/lib/observability/web-vitals";

/**
 * Receives Web Vitals beacons from public pages and turns them into structured logs. Always answers
 * 204 so the endpoint gives no feedback to probing; invalid or cross-site reports are dropped.
 * A bounded read also handles clients that omit or falsify Content-Length.
 */
export async function POST(request: Request): Promise<Response> {
  const noContent = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return noContent;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length < 0 || length > WEB_VITALS_MAX_BODY_BYTES) return noContent;

  let text: string;
  try {
    const limited = await readLimitedText(request, WEB_VITALS_MAX_BODY_BYTES);
    if (limited === null) return noContent;
    text = limited;
  } catch {
    return noContent;
  }

  let report;
  try {
    report = parseWebVitalReport(JSON.parse(text));
  } catch {
    return noContent;
  }
  if (report) logEvent("info", "web_vital", { ...report });
  return noContent;
}
