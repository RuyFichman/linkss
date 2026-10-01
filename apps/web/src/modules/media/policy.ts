import { IMAGE_MAX_DIMENSION } from "@/modules/blocks/limits";

/**
 * Upload policy (ADR 0009). Pure and browser-safe: the editor uses it for early, specific messages;
 * the server uses the same functions as the authority. Decisions come from the bytes only, never
 * from the file name or the MIME type the browser reports.
 */
export const MEDIA_KINDS = ["avatar", "image"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === "string" && (MEDIA_KINDS as readonly string[]).includes(value);
}

export type ImageFormat = "jpeg" | "png" | "webp";

export type UploadRejection = "empty" | "too_large" | "unsupported" | "animated" | "too_many_pixels" | "too_small" | "bad_aspect" | "undecodable";

const MIB = 1024 * 1024;
/** File picked in the browser, before it is cropped and scaled down there. */
export const MAX_SOURCE_BYTES = 15 * MIB;
/** Request body the server accepts (the hosting platform's own limit is 4.5 MB). */
export const MAX_UPLOAD_BYTES = 4 * MIB;
/** Pixel-bomb guard, checked on the header before any decoding. */
export const MAX_IMAGE_DIMENSION = IMAGE_MAX_DIMENSION;
export const MAX_IMAGE_PIXELS = MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION;
/** What a browser is asked to open before scaling down (a 50 MP phone photo still fits). */
export const MAX_SOURCE_PIXELS = 50_000_000;
/** Long edge the browser scales to before sending. */
export const CLIENT_MAX_EDGE = 2048;

export const AVATAR_VARIANT_WIDTHS = [96, 192, 288] as const;
export const AVATAR_MIN_SIDE = 96;
/** 1x, 2x and 3x of the 448 px content column of a public page. */
export const IMAGE_VARIANT_WIDTHS = [448, 896, 1344] as const;
export const IMAGE_MIN_WIDTH = 200;
export const IMAGE_MIN_HEIGHT = 100;
export const IMAGE_MIN_ASPECT = 1 / 3;
export const IMAGE_MAX_ASPECT = 3;
export const WEBP_QUALITY = 80;
/** Per stored object; equals the bucket's file size limit. */
export const MAX_VARIANT_BYTES = 2 * MIB;
export const STORED_CONTENT_TYPE = "image/webp";
/** Keys are immutable (a replaced image gets a new id), so objects can be cached forever. */
export const STORED_CACHE_SECONDS = 31_536_000;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let index = offset; index < offset + length && index < bytes.length; index += 1) text += String.fromCharCode(bytes[index] ?? 0);
  return text;
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0;
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Format from the magic bytes. SVG, GIF, HTML, AVIF, HEIC, BMP and anything else are `null`. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  return null;
}

/** Animated WebP (VP8X animation flag or an ANIM chunk) and APNG (an acTL chunk before the pixels). */
export function isAnimatedImage(bytes: Uint8Array, format: ImageFormat): boolean {
  if (format === "webp") {
    if (ascii(bytes, 12, 4) === "VP8X" && ((bytes[20] ?? 0) & 0x02) !== 0) return true;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      if (ascii(bytes, offset, 4) === "ANIM" || ascii(bytes, offset, 4) === "ANMF") return true;
      const size = (bytes[offset + 4] ?? 0) | ((bytes[offset + 5] ?? 0) << 8) | ((bytes[offset + 6] ?? 0) << 16) | ((bytes[offset + 7] ?? 0) << 24);
      if (size < 0) return false;
      offset += 8 + size + (size % 2);
    }
    return false;
  }
  if (format === "png") {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const type = ascii(bytes, offset + 4, 4);
      if (type === "acTL") return true;
      if (type === "IDAT") return false;
      offset += 12 + uint32be(bytes, offset);
    }
  }
  return false;
}

export interface ImageSize {
  width: number;
  height: number;
}

function jpegSize(bytes: Uint8Array): ImageSize | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) { offset += 1; continue; }
    // Start-of-frame markers carry the dimensions (C4, C8 and CC are tables, not frames).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0), width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    offset += 2 + (((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0));
  }
  return null;
}

function webpSize(bytes: Uint8Array): ImageSize | null {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X" && bytes.length >= 30) return { width: uint24le(bytes, 24) + 1, height: uint24le(bytes, 27) + 1 };
  if (chunk === "VP8 " && bytes.length >= 30) return { width: (((bytes[27] ?? 0) << 8) | (bytes[26] ?? 0)) & 0x3fff, height: (((bytes[29] ?? 0) << 8) | (bytes[28] ?? 0)) & 0x3fff };
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = ((bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Dimensions declared in the header, read without decoding. `null` when they cannot be found. */
export function readImageSize(bytes: Uint8Array, format: ImageFormat): ImageSize | null {
  const size = format === "png" ? (bytes.length >= 24 && ascii(bytes, 12, 4) === "IHDR" ? { width: uint32be(bytes, 16), height: uint32be(bytes, 20) } : null)
    : format === "jpeg" ? jpegSize(bytes) : webpSize(bytes);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

export type UploadPrecheck = { ok: true; format: ImageFormat; size: ImageSize | null } | { ok: false; reason: UploadRejection };

export interface PrecheckLimits {
  /** Real size of the file (the `bytes` given may be just its beginning). */
  byteLength: number;
  maxBytes: number;
  maxPixels: number;
  maxDimension: number | null;
  /** When true (the server, which has the whole file), a missing size is a rejection. */
  requireSize: boolean;
}

/** Everything that can be decided before decoding: size in bytes, format, animation, pixel count. */
export function precheckUpload(bytes: Uint8Array, limits: PrecheckLimits): UploadPrecheck {
  if (limits.byteLength === 0) return { ok: false, reason: "empty" };
  if (limits.byteLength > limits.maxBytes) return { ok: false, reason: "too_large" };
  const format = detectImageFormat(bytes);
  if (!format) return { ok: false, reason: "unsupported" };
  if (isAnimatedImage(bytes, format)) return { ok: false, reason: "animated" };
  const size = readImageSize(bytes, format);
  if (!size) return limits.requireSize ? { ok: false, reason: "undecodable" } : { ok: true, format, size: null };
  if (size.width * size.height > limits.maxPixels || (limits.maxDimension !== null && Math.max(size.width, size.height) > limits.maxDimension)) return { ok: false, reason: "too_many_pixels" };
  return { ok: true, format, size };
}

export const SERVER_PRECHECK = { maxBytes: MAX_UPLOAD_BYTES, maxPixels: MAX_IMAGE_PIXELS, maxDimension: MAX_IMAGE_DIMENSION, requireSize: true } as const;
export const BROWSER_PRECHECK = { maxBytes: MAX_SOURCE_BYTES, maxPixels: MAX_SOURCE_PIXELS, maxDimension: null, requireSize: false } as const;

/** Rules on the decoded (upright) dimensions, per kind. */
export function checkDimensions(kind: MediaKind, size: ImageSize): UploadRejection | null {
  if (kind === "avatar") return Math.min(size.width, size.height) < AVATAR_MIN_SIDE ? "too_small" : null;
  if (size.width < IMAGE_MIN_WIDTH || size.height < IMAGE_MIN_HEIGHT) return "too_small";
  const aspect = size.width / size.height;
  return aspect < IMAGE_MIN_ASPECT || aspect > IMAGE_MAX_ASPECT ? "bad_aspect" : null;
}

/** Widths stored for an image whose largest stored width is `masterWidth`. */
export function imageVariantWidths(masterWidth: number): number[] {
  return [...IMAGE_VARIANT_WIDTHS.filter((width) => width < masterWidth), masterWidth];
}

export interface VariantPlan {
  width: number;
  height: number;
}

/**
 * Variants to produce from an upright source of the given size. Avatars are always the three square
 * sizes (a small source is enlarged, which is acceptable at 96 px on screen); images are never
 * enlarged and keep their aspect ratio. The last item is the master.
 */
export function planVariants(kind: MediaKind, source: ImageSize): VariantPlan[] {
  if (kind === "avatar") return AVATAR_VARIANT_WIDTHS.map((width) => ({ width, height: width }));
  const masterWidth = Math.min(source.width, IMAGE_VARIANT_WIDTHS[IMAGE_VARIANT_WIDTHS.length - 1] ?? source.width);
  return imageVariantWidths(masterWidth).map((width) => ({ width, height: Math.max(1, Math.round((source.height * width) / source.width)) }));
}

/** Object key of one variant. The media id is random, so keys cannot be guessed or listed. */
export function variantKey(mediaId: string, width: number): string {
  return `${mediaId}/${width}.webp`;
}

const MEDIA_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isMediaId(value: unknown): value is string {
  return typeof value === "string" && MEDIA_ID_PATTERN.test(value);
}
