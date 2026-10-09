import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { configuredSync } from "@/modules/billing/server";
import { processWebhook } from "@/modules/billing/service";
import { revalidatePublicPage } from "@/modules/publishing/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Larger than any event the provider sends about one subscription; smaller than what would hurt. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Payment provider webhook (ADR 0014, runbook BILLING.md). An unauthenticated public endpoint
 * written to by a third party, so:
 *   - the body is read raw and the signature and its timestamp are checked before anything is parsed;
 *   - a delivery is only a hint: the handler reads the provider's current state and hands a signed
 *     snapshot to the database, where the event id makes a repeated delivery change nothing;
 *   - the work is bounded (provider calls and the database call time out) and the answer is the
 *     status alone: 200 done, 400 not valid, 503 try again;
 *   - logs carry the correlation id, the topic and the outcome. Never the payload, a signature, a
 *     provider id or anything about a person.
 * With billing off (no secrets, or the mode says so) the route answers 503 and changes nothing.
 * Global rate limiting in front of this route is Sprint 9 (docs/THREAT_MODEL.md).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = performance.now();
  const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
  const headers = { "cache-control": "no-store", [CORRELATION_HEADER]: correlationId };
  const answer = (status: number, outcome: string, level: "info" | "warn" | "error", fields: Record<string, string | number | boolean | null> = {}) => {
    logEvent(level, "billing.webhook", { correlationId, outcome, ...fields, durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ received: status === 200 }, { status, headers });
  };

  const sync = configuredSync();
  if (!sync) return answer(503, "billing_off", "warn");

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return answer(400, "too_large", "warn");
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return answer(400, "malformed", "warn");
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return answer(400, "too_large", "warn");

  const result = await processWebhook(sync, { rawBody, signatureHeader: request.headers.get("stripe-signature") });
  // A plan change reaches pages that are already published: drop their cached copies now.
  for (const slug of result.slugs) revalidatePublicPage(slug);

  const level = result.http === 503 || result.outcome === "price_mismatch" || result.outcome === "conflict" || result.outcome === "customer_mismatch" ? "error"
    : result.http === 400 || result.outcome === "unknown_customer" || result.outcome === "invalid" || result.outcome === "expired" || result.topic === "dispute" || result.topic === "refund" ? "warn"
    : "info";
  return answer(result.http, result.outcome, level, { topic: result.topic, planChanged: result.planChanged });
}
