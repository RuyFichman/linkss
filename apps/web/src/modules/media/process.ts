import "server-only";
import sharp from "sharp";
import { checkDimensions, MAX_IMAGE_PIXELS, MAX_VARIANT_BYTES, planVariants, precheckUpload, SERVER_PRECHECK, WEBP_QUALITY, type ImageSize, type MediaKind, type UploadRejection } from "./policy";

export interface ProcessedVariant {
  width: number;
  height: number;
  bytes: number;
  body: Uint8Array;
}

export type ProcessResult =
  | { ok: true; master: ImageSize; variants: ProcessedVariant[] }
  | { ok: false; reason: UploadRejection };

/**
 * Validates the real content of an upload and produces the stored variants (ADR 0009). The bytes
 * received are never stored: every variant is re-encoded from decoded pixels as WebP, which drops
 * EXIF/XMP/ICC metadata (including GPS) and anything hidden after the image data. The only file
 * that uses `sharp`.
 */
export async function processUpload(bytes: Uint8Array, kind: MediaKind): Promise<ProcessResult> {
  // 1. Before decoding: byte cap, magic bytes, animation, pixel count from the header.
  const precheck = precheckUpload(bytes, { ...SERVER_PRECHECK, byteLength: bytes.length });
  if (!precheck.ok) return precheck;

  // 2. Decode. The decoder has its own pixel limit and stops on any error.
  const options = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error", animated: false } as const;
  let upright: ImageSize;
  try {
    const metadata = await sharp(bytes, options).metadata();
    if ((metadata.pages ?? 1) > 1) return { ok: false, reason: "animated" };
    // The decoder must agree with the magic bytes; anything else is not one of the accepted formats.
    if (metadata.format !== precheck.format) return { ok: false, reason: "unsupported" };
    upright = { width: metadata.autoOrient.width, height: metadata.autoOrient.height };
  } catch {
    return { ok: false, reason: "undecodable" };
  }
  if (!(upright.width > 0 && upright.height > 0)) return { ok: false, reason: "undecodable" };
  if (upright.width * upright.height > MAX_IMAGE_PIXELS) return { ok: false, reason: "too_many_pixels" };

  // 3. Rules per kind, on the upright dimensions.
  const dimensionProblem = checkDimensions(kind, upright);
  if (dimensionProblem) return { ok: false, reason: dimensionProblem };

  // 4. Re-encode each variant from the decoded pixels.
  const variants: ProcessedVariant[] = [];
  try {
    for (const plan of planVariants(kind, upright)) {
      const { data, info } = await sharp(bytes, options)
        .autoOrient()
        .resize(plan.width, plan.height, { fit: kind === "avatar" ? "cover" : "fill" })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
      if (info.size > MAX_VARIANT_BYTES) return { ok: false, reason: "too_large" };
      variants.push({ width: info.width, height: info.height, bytes: info.size, body: new Uint8Array(data) });
    }
  } catch {
    return { ok: false, reason: "undecodable" };
  }
  const master = variants[variants.length - 1];
  if (!master) return { ok: false, reason: "undecodable" };
  return { ok: true, master: { width: master.width, height: master.height }, variants };
}
