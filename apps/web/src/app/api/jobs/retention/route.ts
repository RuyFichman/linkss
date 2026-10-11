import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { secretsMatch } from "@/lib/same-origin";
import { retentionTotal } from "@/modules/privacy/retention";
import { runConfiguredRetention } from "@/modules/privacy/retention-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET_MIN_LENGTH = 32;

/**
 * Retention job (ADR 0018, runbook RETENTION.md). Same contract as the other jobs: it needs
 * `Authorization: Bearer <CRON_SECRET>`, is never reachable with a user session and is safe to
 * call repeatedly. GET exists because Vercel Cron calls with GET; POST is for manual runs.
 *
 * It removes what is past its documented retention period (expired leads, finished invitations
 * and report links, decided abuse reports, old privacy requests, audit events and address holds)
 * and the pages and workspaces deleted more than 30 days ago. It runs after the media job, which
 * must remove a page's image files before the page itself can go: `pendingProfiles` and
 * `pendingWorkspaces` say how many still wait.
 *
 * Before the migration the function does not exist: the route answers 503 `not_deployed`.
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
    logEvent(level, "retention.maintenance", { correlationId, outcome, durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ ok: false, error: outcome }, { status, headers });
  };

  if (expected.length < SECRET_MIN_LENGTH) return fail("not_configured", 503);
  if (!secretsMatch(given, expected)) return fail("unauthorized", 401);

  try {
    const result = await runConfiguredRetention();
    if (result.kind === "not_configured") return fail("not_configured", 503);
    if (result.kind === "not_deployed") return fail("not_deployed", 503);
    const { report } = result;
    // `partial`: something past its date is still there, usually waiting for the media job.
    const outcome = report.pendingProfiles > 0 || report.pendingWorkspaces > 0 ? "partial" : "ok";
    // Counts only: the log never says whose rows were removed.
    logEvent("info", "retention.maintenance", { correlationId, outcome, ...report, removed: retentionTotal(report), durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ ok: true, ...report }, { headers });
  } catch {
    return fail("unavailable", 503, "error");
  }
}
