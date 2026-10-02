import { after } from "next/server";
import { appUrl } from "@/lib/app-url";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { analyticsSigningSecret } from "@/modules/analytics/attestation";
import { MAX_REQUEST_BYTES } from "@/modules/analytics/contract";
import { DEFAULT_REPORTING_TIME_ZONE, localDay } from "@/modules/analytics/dates";
import { deliverIngestion, hasSessionCookie, prepareIngestion } from "@/modules/analytics/ingest";
import { createSupabaseIngestRepository } from "@/modules/analytics/ingest-server";
import { clientAddress } from "@/modules/leads/visitor-hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES = ["text/plain", "application/json"];

function ownHost(): string | null {
  try {
    return new URL(appUrl()).hostname;
  } catch {
    return null;
  }
}

/**
 * Customer-analytics ingestion (ADR 0011). Receives beacons from public pages and always answers
 * 204 with no body, before the database is involved: the write runs after the response, so a slow
 * or unavailable database never delays a visitor, and nothing the client does depends on the
 * answer. Cross-site, oversized and malformed requests, automated traffic and signed-in people are
 * dropped. Logs carry the outcome and counts, never the payload, the hash, the referrer or the
 * user agent. Global rate limiting in front of this route is Sprint 9 (docs/THREAT_MODEL.md).
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const noContent = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
  const drop = (outcome: string): Response => {
    logEvent("info", "analytics.ingest", { correlationId, outcome });
    return noContent;
  };

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return drop("cross_site");
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!CONTENT_TYPES.includes(contentType)) return drop("invalid");
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > MAX_REQUEST_BYTES) return drop("invalid");

  let body: string;
  try {
    body = await request.text();
  } catch {
    return drop("invalid");
  }

  const prepared = prepareIngestion({
    body,
    userAgent: request.headers.get("user-agent"),
    ip: clientAddress(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")),
    country: request.headers.get("x-vercel-ip-country"),
    signedIn: hasSessionCookie(request.headers.get("cookie")),
    ownHost: ownHost(),
    day: localDay(new Date(), DEFAULT_REPORTING_TIME_ZONE),
    salt: process.env.VISITOR_HASH_SALT,
    signingSecret: analyticsSigningSecret(),
  });
  if (!prepared.send) return drop(prepared.reason);

  // The response does not wait for the database.
  after(async () => {
    let outcome;
    try {
      outcome = await deliverIngestion(createSupabaseIngestRepository(), prepared);
    } catch {
      // Not configured (no Supabase URL or key in this environment).
      outcome = { status: "unavailable" as const, accepted: 0, duplicate: 0, repeat: 0, rejected: 0, rateLimited: 0 };
    }
    // `shedding`: the raw table reached its capacity guard and every event is being dropped.
    logEvent(outcome.status === "ok" ? "info" : outcome.status === "unavailable" || outcome.status === "shedding" ? "error" : "warn", "analytics.ingest", {
      correlationId,
      outcome: outcome.status,
      events: prepared.events,
      accepted: outcome.accepted,
      duplicate: outcome.duplicate,
      repeat: outcome.repeat,
      rejected: outcome.rejected + prepared.dropped,
      rateLimited: outcome.rateLimited,
      hashed: prepared.hashed,
      durationMs: Math.round(performance.now() - startedAt),
    });
  });
  return noContent;
}
