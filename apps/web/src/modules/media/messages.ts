import { MEDIA_COPY } from "@/content/pt-BR";
import { MAX_SOURCE_BYTES, type MediaKind } from "./policy";
import type { UploadFailure } from "./upload-machine";

const SOURCE_LIMIT_MB = MAX_SOURCE_BYTES / (1024 * 1024);

/** What the person reads for each way an upload can fail: what happened and what to do next. */
export function uploadErrorMessage(error: UploadFailure, kind: MediaKind): string {
  switch (error) {
    case "too_large": return MEDIA_COPY.errors.too_large(SOURCE_LIMIT_MB);
    case "too_small": return kind === "avatar" ? MEDIA_COPY.errors.too_small_avatar : MEDIA_COPY.errors.too_small_image;
    default: return MEDIA_COPY.errors[error];
  }
}

const UNITS = ["KB", "MB", "GB"] as const;

/** "1,2 MB": binary units, one decimal below 10, pt-BR decimal comma. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes) / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${UNITS[unit]}`;
}
