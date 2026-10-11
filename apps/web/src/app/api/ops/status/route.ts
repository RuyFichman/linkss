import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { secretsMatch } from "@/lib/same-origin";
import { resolveBillingMode } from "@/modules/billing/mode";
import { evaluateOps, opsPasses } from "@/modules/ops/status";
import { readOpsSnapshot } from "@/modules/ops/status-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET_MIN_LENGTH = 32;

/**
 * Operational status for the external monitor (ADR 0019, runbook MONITORING.md). Needs
 * `Authorization: Bearer <OPS_STATUS_SECRET>`, a secret of its own: it only reads, so the monitor
 * never holds the secret that runs jobs. Answers 200 when every check that counts passes and 503
 * otherwise, with the list of checks either way. `?attention=1` also counts the checks about work
 * waiting for a person (the monitor asks for them once a day).
 *
 * The body has counts, durations and reason codes: nothing that names a person, a page or a
 * workspace, and no secret. `/api/health` stays the cheap, public, database-free probe.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
  const expected = process.env.OPS_STATUS_SECRET ?? "";
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const headers = { "cache-control": "no-store", [CORRELATION_HEADER]: correlationId };
  const fail = (error: "not_configured" | "unauthorized" | "not_deployed" | "unavailable", status: number) => {
    logEvent(error === "unavailable" ? "error" : "warn", "ops.status", { correlationId, outcome: error });
    return NextResponse.json({ ok: false, error }, { status, headers });
  };

  if (expected.length < SECRET_MIN_LENGTH) return fail("not_configured", 503);
  if (!secretsMatch(given, expected)) return fail("unauthorized", 401);

  const read = await readOpsSnapshot();
  if (read.kind !== "ok") return fail(read.kind, 503);

  const billing = resolveBillingMode();
  const checks = evaluateOps(read.snapshot, { billing: { asked: process.env.BILLING_MODE ?? "off", mode: billing.mode, reason: billing.reason } });
  const includeAttention = new URL(request.url).searchParams.get("attention") === "1";
  const ok = opsPasses(checks, includeAttention);
  const failing = checks.filter((check) => !check.ok).map((check) => check.name);
  logEvent(ok ? "info" : "warn", "ops.status", { correlationId, outcome: ok ? "ok" : "failing", attention: includeAttention, failing: failing.join(",") });
  return NextResponse.json({ ok, checkedAt: read.snapshot.now, failing, checks }, { status: ok ? 200 : 503, headers });
}
