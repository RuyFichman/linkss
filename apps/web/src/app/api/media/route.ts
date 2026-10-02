import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { isSameOriginRequest } from "@/lib/same-origin";
import { MAX_UPLOAD_BYTES } from "@/modules/media/policy";
import { getMediaService } from "@/modules/media/server";
import type { UploadErrorKind, UploadResult } from "@/modules/media/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Multipart framing and the two small fields on top of the file itself. */
const BODY_OVERHEAD_BYTES = 64 * 1024;

function statusFor(error: UploadErrorKind): number {
  switch (error) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "not_found": return 404;
    case "quota": return 409;
    case "too_large": return 413;
    case "rate_limited": return 429;
    case "unavailable": return 503;
    default: return 422;
  }
}

function respond(result: UploadResult, correlationId: string, startedAt: number, bytes: number, kind: unknown): NextResponse {
  // The log carries the outcome and sizes only: never the file name, its content or the page id.
  logEvent(result.ok ? "info" : result.error === "unavailable" ? "error" : "warn", "media.upload", {
    correlationId,
    outcome: result.ok ? "ok" : result.error,
    kind: kind === "avatar" || kind === "image" ? kind : "unknown",
    receivedBytes: bytes,
    storedBytes: result.ok ? result.media.bytes : undefined,
    durationMs: Math.round(performance.now() - startedAt),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store", [CORRELATION_HEADER]: correlationId } });
}

/**
 * Image upload (ADR 0009). A route handler rather than a Server Action because the editor needs
 * upload progress and cancellation. Everything in the request is untrusted: the service
 * re-authorizes the page, validates and re-encodes the bytes, and only then stores the variants.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = performance.now();
  const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
  if (!isSameOriginRequest(request.headers)) return respond({ ok: false, error: "forbidden" }, correlationId, startedAt, 0, null);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_UPLOAD_BYTES + BODY_OVERHEAD_BYTES) return respond({ ok: false, error: "too_large" }, correlationId, startedAt, 0, null);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return respond({ ok: false, error: "unsupported" }, correlationId, startedAt, 0, null);
  }
  const file = form.get("file");
  const kind = form.get("kind");
  if (!(file instanceof Blob)) return respond({ ok: false, error: "empty" }, correlationId, startedAt, 0, kind);
  if (file.size > MAX_UPLOAD_BYTES) return respond({ ok: false, error: "too_large" }, correlationId, startedAt, file.size, kind);

  const bytes = new Uint8Array(await file.arrayBuffer());
  let result: UploadResult;
  try {
    result = await (await getMediaService()).upload(form.get("profileId"), kind, bytes);
  } catch {
    result = { ok: false, error: "unavailable" };
  }
  return respond(result, correlationId, startedAt, bytes.length, kind);
}
