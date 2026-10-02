import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { secretsMatch } from "@/lib/same-origin";
import { runConfiguredMediaCleanup } from "@/modules/media/cleanup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET_MIN_LENGTH = 32;

/**
 * Orphan media cleanup (ADR 0009, runbook MEDIA.md). An administrative job: it needs the job secret
 * in `Authorization: Bearer <CRON_SECRET>` and is never reachable with a user session. Safe to call
 * repeatedly.
 *
 * GET exists only because Vercel Cron calls with GET (sending the same bearer secret); it is the one
 * state-changing GET in the product and is equally gated by the secret, so a link or prefetch cannot
 * trigger it. POST stays for manual runs.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return runCleanupJob(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return runCleanupJob(request);
}

async function runCleanupJob(request: Request): Promise<NextResponse> {
  const startedAt = performance.now();
  const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
  const expected = process.env.CRON_SECRET ?? "";
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const headers = { "cache-control": "no-store", [CORRELATION_HEADER]: correlationId };

  if (expected.length < SECRET_MIN_LENGTH) {
    logEvent("warn", "media.cleanup", { correlationId, outcome: "not_configured" });
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503, headers });
  }
  if (!secretsMatch(given, expected)) {
    logEvent("warn", "media.cleanup", { correlationId, outcome: "unauthorized" });
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
  }

  try {
    const report = await runConfiguredMediaCleanup();
    if (!report) {
      logEvent("warn", "media.cleanup", { correlationId, outcome: "not_configured" });
      return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503, headers });
    }
    logEvent(report.failed > 0 ? "warn" : "info", "media.cleanup", { correlationId, outcome: report.failed > 0 ? "partial" : "ok", ...report, durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ ok: true, ...report }, { headers });
  } catch {
    logEvent("error", "media.cleanup", { correlationId, outcome: "unavailable", durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers });
  }
}
