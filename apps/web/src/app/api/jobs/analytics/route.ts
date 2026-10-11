import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { secretsMatch } from "@/lib/same-origin";
import { recordJobRun } from "@/modules/ops/status-server";
import { isDay } from "@/modules/analytics/dates";
import { runConfiguredAnalyticsMaintenance } from "@/modules/analytics/maintenance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET_MIN_LENGTH = 32;

/**
 * Customer-analytics job (ADR 0011, runbook ANALYTICS.md): aggregates the days that are not final,
 * then purges raw events past their retention. Same contract as the media cleanup job: it needs
 * `Authorization: Bearer <CRON_SECRET>`, is never reachable with a user session and is safe to
 * call repeatedly. GET exists because Vercel Cron calls with GET; POST is for manual runs, where
 * `?day=YYYY-MM-DD` re-aggregates one day that still has its raw events.
 *
 * Before the Sprint 6 migration is applied the function does not exist: the route answers 503
 * `not_deployed` and changes nothing.
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
  const fail = (outcome: "not_configured" | "unauthorized" | "invalid" | "not_deployed" | "unavailable", status: number, level: "warn" | "error" = "warn") => {
    logEvent(level, "analytics.maintenance", { correlationId, outcome, durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ ok: false, error: outcome }, { status, headers });
  };

  if (expected.length < SECRET_MIN_LENGTH) return fail("not_configured", 503);
  if (!secretsMatch(given, expected)) return fail("unauthorized", 401);

  const day = new URL(request.url).searchParams.get("day");
  if (day !== null && !isDay(day)) return fail("invalid", 400);

  try {
    const result = await runConfiguredAnalyticsMaintenance(day);
    if (result.kind === "not_configured") return fail("not_configured", 503);
    if (result.kind === "not_deployed") return fail("not_deployed", 503);
    const { report } = result;
    if (report.status === "out_of_range") return fail("invalid", 400);
    // `partial`: the per-run bound was reached and days are still waiting; the next run continues.
    const outcome = report.pendingDays > 0 ? "partial" : "ok";
    await recordJobRun("analytics", outcome);
    logEvent(outcome === "ok" ? "info" : "warn", "analytics.maintenance", { correlationId, outcome, ...report, durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ ok: true, ...report }, { headers });
  } catch {
    await recordJobRun("analytics", "unavailable");
    return fail("unavailable", 503, "error");
  }
}
