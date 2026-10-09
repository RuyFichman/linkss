import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { secretsMatch } from "@/lib/same-origin";
import { runConfiguredBillingMaintenance } from "@/modules/billing/server";
import { revalidatePublicPage } from "@/modules/publishing/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET_MIN_LENGTH = 32;

/**
 * Billing job (ADR 0014, runbook BILLING.md). Same contract as the other jobs: it needs
 * `Authorization: Bearer <CRON_SECRET>`, is never reachable with a user session and is safe to
 * call repeatedly. GET exists because Vercel Cron calls with GET; POST is for manual runs.
 *
 * It does what no event does: ends a grace period whose deadline passed, applies a cheaper plan
 * when its paid period ends, purges the event ledger, and reads again at the provider every
 * subscription that was not read for a day, which is the repair for a webhook that never arrived.
 * Bounded: 50 subscriptions per run; `pending` says how many wait for the next one.
 *
 * Before the Sprint 8 migration the function does not exist: the route answers 503 `not_deployed`.
 * With billing off the clock still runs and nothing is read at the provider.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return runJob(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return runJob(request);
}

async function runJob(request: Request): Promise<NextResponse> {
  const startedAt = performance.now();
  const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
  const expected = process.env.CRON_SECRET ?? "";
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const headers = { "cache-control": "no-store", [CORRELATION_HEADER]: correlationId };
  const fail = (outcome: "not_configured" | "unauthorized" | "not_deployed" | "unavailable", status: number, level: "warn" | "error" = "warn") => {
    logEvent(level, "billing.maintenance", { correlationId, outcome, durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ ok: false, error: outcome }, { status, headers });
  };

  if (expected.length < SECRET_MIN_LENGTH) return fail("not_configured", 503);
  if (!secretsMatch(given, expected)) return fail("unauthorized", 401);

  try {
    const result = await runConfiguredBillingMaintenance();
    if (result.kind === "not_configured") return fail("not_configured", 503);
    if (result.kind === "not_deployed") return fail("not_deployed", 503);
    const { slugs, ...report } = result.report;
    for (const slug of new Set(slugs)) revalidatePublicPage(slug);
    // `partial`: a provider read failed or the per-run bound was reached; the next run continues.
    const outcome = report.failed > 0 || report.pending > 0 ? "partial" : "ok";
    // A correction means a webhook was lost: worth a warning even when the run itself went well.
    logEvent(outcome === "ok" && report.corrected === 0 ? "info" : "warn", "billing.maintenance", { correlationId, outcome, ...report, durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ ok: true, ...report }, { headers });
  } catch {
    return fail("unavailable", 503, "error");
  }
}
