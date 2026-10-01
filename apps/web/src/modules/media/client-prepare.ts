import { cropRect, outputSize, type CropRect, type CropState } from "./crop";
import { AVATAR_VARIANT_WIDTHS, BROWSER_PRECHECK, checkDimensions, CLIENT_MAX_EDGE, precheckUpload, type ImageSize, type MediaKind, type UploadRejection } from "./policy";

/**
 * Browser pre-pass (ADR 0009): early, specific messages and a smaller request. Nothing here is
 * trusted by the server, which validates and re-encodes whatever it receives.
 */
export interface PickedImage {
  bitmap: ImageBitmap;
  size: ImageSize;
}

/** Enough of the file to find the dimensions of a JPEG that starts with large metadata blocks. */
const HEADER_BYTES = 512 * 1024;
const ENCODE_QUALITY = 0.9;
/** Avatars are stored at 288 px at most; twice that keeps the server's downscale clean. */
const AVATAR_MAX_EDGE = (AVATAR_VARIANT_WIDTHS[AVATAR_VARIANT_WIDTHS.length - 1] ?? 288) * 2;

export type PickOutcome = { ok: true; image: PickedImage } | { ok: false; error: UploadRejection };

/** Checks the picked file from its bytes and opens it. The EXIF orientation is applied by the browser. */
export async function readPickedImage(file: Blob): Promise<PickOutcome> {
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const precheck = precheckUpload(header, { ...BROWSER_PRECHECK, byteLength: file.size });
  if (!precheck.ok) return { ok: false, error: precheck.reason };
  try {
    const bitmap = await createImageBitmap(file);
    return { ok: true, image: { bitmap, size: { width: bitmap.width, height: bitmap.height } } };
  } catch {
    return { ok: false, error: "undecodable" };
  }
}

export function maxEdgeFor(kind: MediaKind): number {
  return kind === "avatar" ? AVATAR_MAX_EDGE : CLIENT_MAX_EDGE;
}

/** Draws the selected rectangle of the image into a canvas of the given size. */
export function drawCrop(canvas: HTMLCanvasElement, image: PickedImage, rect: CropRect, size: ImageSize, flatten: boolean): boolean {
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return false;
  if (flatten) {
    // JPEG has no transparency: transparent areas become white instead of black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image.bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, size.width, size.height);
  return true;
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, ENCODE_QUALITY));
}

export type RenderOutcome = { ok: true; blob: Blob } | { ok: false; error: UploadRejection };

/**
 * Applies the crop, scales the result down and encodes it for upload: WebP where the browser can
 * encode it (keeps transparency), JPEG otherwise.
 */
export async function renderCrop(image: PickedImage, crop: CropState, kind: MediaKind): Promise<RenderOutcome> {
  const rect = cropRect(image.size, crop);
  const size = outputSize(rect, maxEdgeFor(kind));
  const problem = checkDimensions(kind, size);
  if (problem) return { ok: false, error: problem };
  const canvas = document.createElement("canvas");
  if (!drawCrop(canvas, image, rect, size, false)) return { ok: false, error: "undecodable" };
  let blob = await encode(canvas, "image/webp");
  if (!blob || blob.type !== "image/webp") {
    if (!drawCrop(canvas, image, rect, size, true)) return { ok: false, error: "undecodable" };
    blob = await encode(canvas, "image/jpeg");
  }
  return blob ? { ok: true, blob } : { ok: false, error: "undecodable" };
}
