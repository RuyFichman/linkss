import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { secretsMatch } from "@/lib/same-origin";
import { runMailMaintenance } from "@/modules/mail/server";
import { recordJobRun } from "@/modules/ops/status-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET_MIN_LENGTH = 32;

/**
 * Transactional e-mail job (ADR 0021, runbook MAIL.md). Same contract as the other jobs:
 * `Authorization: Bearer <CRON_SECRET>`, safe to call repeatedly; GET for Vercel Cron, POST for a
 * manual run. Queues the yearly renewal reminders, expires what waited too long, purges what
 * finished 30 days ago and sends what is due (up to 200 messages; the rest go first next time).
 *
 * Most messages are sent minutes after their fact, by the request that caused it; this run is the
 * safety net for a provider that was down. With mail off it still runs the housekeeping and
 * answers `mail_off`, which counts as a good run.
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
    logEvent(level, "mail.maintenance", { correlationId, outcome, durationMs: Math.round(performance.now() - startedAt) });
    return NextResponse.json({ ok: false, error: outcome }, { status, headers });
  };

  if (expected.length < SECRET_MIN_LENGTH) return fail("not_configured", 503);
  if (!secretsMatch(given, expected)) return fail("unauthorized", 401);

  try {
    const result = await runMailMaintenance();
    if (result.kind === "not_configured") return fail("not_configured", 503);
    if (result.kind === "not_deployed") return fail("not_deployed", 503);
    const { maintenance, drain } = result;
    const sending = drain.kind === "done" ? drain.report : null;
    // `partial`: some messages will be tried again; `mail_off`: nothing is sent in this environment.
    const outcome = drain.kind === "mail_off" ? "mail_off" : drain.kind !== "done" ? "unavailable" : sending && sending.retried + sending.failed > 0 ? "partial" : "ok";
    await recordJobRun("mail", outcome === "mail_off" ? "ok" : outcome);
    // Counts only: never an address, a page or a workspace.
    logEvent(outcome === "ok" || outcome === "mail_off" ? "info" : "warn", "mail.maintenance", {
      correlationId, outcome, ...(drain.kind === "mail_off" ? { reason: drain.reason } : {}), ...maintenance, ...(sending ?? {}), durationMs: Math.round(performance.now() - startedAt),
    });
    return NextResponse.json({ ok: true, outcome, ...maintenance, ...(sending ?? {}) }, { headers });
  } catch {
    await recordJobRun("mail", "unavailable");
    return fail("unavailable", 503, "error");
  }
}
