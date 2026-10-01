import { isMediaId, isMediaKind, type MediaKind } from "./policy";
import type { UploadedMedia, UploadErrorKind } from "./service";
import type { SendOutcome, UploadFailure } from "./upload-machine";

const KNOWN_ERRORS: ReadonlySet<string> = new Set<UploadErrorKind>([
  "empty", "too_large", "unsupported", "animated", "too_many_pixels", "too_small", "bad_aspect", "undecodable",
  "quota", "rate_limited", "forbidden", "not_found", "unauthenticated", "unavailable",
]);

function parseMedia(value: unknown): UploadedMedia | null {
  if (!value || typeof value !== "object") return null;
  const media = value as Record<string, unknown>;
  if (!isMediaId(media.mediaId) || !isMediaKind(media.kind)) return null;
  if (typeof media.width !== "number" || typeof media.height !== "number" || typeof media.bytes !== "number") return null;
  return { mediaId: media.mediaId, kind: media.kind, width: media.width, height: media.height, bytes: media.bytes };
}

/** Reads the route's JSON. Anything unexpected is "unavailable", never a silent success. */
export function parseUploadResponse(body: unknown): SendOutcome {
  if (!body || typeof body !== "object") return { ok: false, error: "unavailable" };
  const response = body as Record<string, unknown>;
  if (response.ok === true) {
    const media = parseMedia(response.media);
    return media ? { ok: true, media } : { ok: false, error: "unavailable" };
  }
  return { ok: false, error: typeof response.error === "string" && KNOWN_ERRORS.has(response.error) ? (response.error as UploadFailure) : "unavailable" };
}

/**
 * Sends the prepared image to POST /api/media. XMLHttpRequest because `fetch` cannot report upload
 * progress. Rejects on a network failure (the controller reports it as retryable).
 */
export function sendUpload(blob: Blob, target: { profileId: string; kind: MediaKind }, hooks: { signal: AbortSignal; onProgress: (fraction: number) => void }): Promise<SendOutcome> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("profileId", target.profileId);
    form.set("kind", target.kind);
    form.set("file", blob, "upload");

    const request = new XMLHttpRequest();
    request.open("POST", "/api/media");
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) hooks.onProgress(event.loaded / event.total);
    };
    request.upload.onload = () => hooks.onProgress(1);
    request.onload = () => resolve(parseUploadResponse(request.response));
    request.onerror = () => reject(new Error("network"));
    request.ontimeout = () => reject(new Error("network"));
    request.onabort = () => resolve({ ok: false, error: "network" });
    hooks.signal.addEventListener("abort", () => request.abort(), { once: true });
    if (hooks.signal.aborted) {
      resolve({ ok: false, error: "network" });
      return;
    }
    request.send(form);
  });
}
