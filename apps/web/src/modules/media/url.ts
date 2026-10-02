import { AVATAR_VARIANT_WIDTHS, imageVariantWidths, variantKey } from "./policy";

/**
 * Public URLs of stored media (ADR 0009). Drafts and snapshots keep only the media id; the address
 * is built here at render time, so moving the bucket to another object store is a configuration
 * change. No vendor SDK: this module is imported by the public renderer and by the editor preview.
 */
export const MEDIA_BUCKET = "media";

/** Base address of the bucket, without a trailing slash. */
export function mediaBaseUrl(): string {
  // Referenced statically so Next.js can inline the values in browser bundles.
  const override = process.env.NEXT_PUBLIC_MEDIA_BASE_URL;
  if (override) return override.replace(/\/+$/, "");
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return `${supabaseUrl}/storage/v1/object/public/${MEDIA_BUCKET}`;
}

export function publicMediaUrl(key: string): string {
  return `${mediaBaseUrl()}/${key}`;
}

/** Origin to preconnect to when a page shows media, or null when it cannot be determined. */
export function mediaOrigin(): string | null {
  try {
    return new URL(mediaBaseUrl()).origin;
  } catch {
    return null;
  }
}

/** Content column of a public page: full width minus the page padding, 448 px at most. */
export const IMAGE_SIZES = "(max-width: 480px) calc(100vw - 2rem), 448px";

export interface ImageSources {
  src: string;
  srcSet: string;
  sizes: string;
}

/** `src` is the smallest variant (the fallback for browsers without `srcset`). */
export function imageSources(mediaId: string, masterWidth: number): ImageSources {
  const widths = imageVariantWidths(masterWidth);
  return {
    src: publicMediaUrl(variantKey(mediaId, widths[0] ?? masterWidth)),
    srcSet: widths.map((width) => `${publicMediaUrl(variantKey(mediaId, width))} ${width}w`).join(", "),
    sizes: IMAGE_SIZES,
  };
}

/** Avatars are shown at 96 CSS pixels: one variant per device pixel ratio. */
export function avatarSources(mediaId: string): { src: string; srcSet: string } {
  const [base = 96] = AVATAR_VARIANT_WIDTHS;
  return {
    src: publicMediaUrl(variantKey(mediaId, base)),
    srcSet: AVATAR_VARIANT_WIDTHS.map((width) => `${publicMediaUrl(variantKey(mediaId, width))} ${width / base}x`).join(", "),
  };
}
