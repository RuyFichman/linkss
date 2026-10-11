import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { secretsMatch } from "@/lib/same-origin";
import { runConfiguredDomainRecheck } from "@/modules/domains/recheck-server";
import { recordJobRun } from "@/modules/ops/status-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET_MIN_LENGTH = 32;

/**
 * Custom-domain re-verification job (ADR 0016, runbook DOMAINS.md). Same contract as the other
 * jobs: `Authorization: Bearer <CRON_SECRET>`, never reachable with a user session, safe to call
 * repeatedly. GET is what Vercel Cron calls; POST is for manual runs.
 *
 * Reads the proof of control of every active domain again. A domain whose proof is absent for
 * seven consecutive days lapses and stops opening its page; a day on which DNS could not be asked
 * counts for nothing. Up to 200 domains per run; the rest are first in line the next day.
 *
 * In an environment without the domains signing secret no domain can be active: the route answers
 * 200 with `skipped`, and that counts as a good run.
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
    logEvent(level, "domains.recheck", { correlationId, outcome, durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ ok: false, error: outcome }, { status, headers });
  };

  if (expected.length < SECRET_MIN_LENGTH) return fail("not_configured", 503);
  if (!secretsMatch(given, expected)) return fail("unauthorized", 401);

  try {
    const result = await runConfiguredDomainRecheck();
    if (result.kind === "not_configured") return fail("not_configured", 503);
    if (result.kind === "not_deployed") return fail("not_deployed", 503);
    if (result.kind === "domains_off") {
      await recordJobRun("domains", "ok");
      logEvent("info", "domains.recheck", { correlationId, outcome: "skipped", durationMs: Math.round(performance.now() - startedAt) });
      return NextResponse.json({ ok: true, skipped: "domains_off" }, { headers });
    }
    const { report } = result;
    // `partial`: some domains could not be checked or recorded today; they are first in line tomorrow.
    const outcome = report.dnsUnavailable > 0 || report.failed > 0 ? "partial" : "ok";
    await recordJobRun("domains", outcome);
    // Counts only: the log never names a hostname.
    logEvent(report.lapsed > 0 || outcome === "partial" ? "warn" : "info", "domains.recheck", { correlationId, outcome, ...report, durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ ok: true, ...report }, { headers });
  } catch {
    await recordJobRun("domains", "unavailable");
    return fail("unavailable", 503, "error");
  }
}
