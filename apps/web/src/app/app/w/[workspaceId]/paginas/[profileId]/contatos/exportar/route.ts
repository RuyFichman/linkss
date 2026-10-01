import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { isSameOriginRequest } from "@/lib/same-origin";
import { getLeadsService } from "@/modules/leads/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS = { unauthenticated: 401, forbidden: 403, not_found: 404, unavailable: 503 } as const;

/**
 * CSV export of a page's leads (ADR 0010). POST with a same-origin check, so a link on another
 * site cannot trigger it; the service authorizes `leads.export` and records the audit event before
 * the file is produced. The log carries the count only, never lead content.
 */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; profileId: string }> }): Promise<NextResponse> {
  const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
  const headers = { "cache-control": "no-store", [CORRELATION_HEADER]: correlationId };
  if (!isSameOriginRequest(request.headers)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });

  const { profileId } = await context.params;
  let result: Awaited<ReturnType<Awaited<ReturnType<typeof getLeadsService>>["exportCsv"]>>;
  try {
    result = await (await getLeadsService()).exportCsv(profileId);
  } catch {
    result = { ok: false, error: "unavailable" };
  }
  logEvent(result.ok ? "info" : result.error === "unavailable" ? "error" : "warn", "lead.export", { correlationId, outcome: result.ok ? "ok" : result.error, count: result.ok ? result.value.count : undefined });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error], headers });

  return new NextResponse(result.value.csv, {
    headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="contatos.csv"', "x-content-type-options": "nosniff" },
  });
}
