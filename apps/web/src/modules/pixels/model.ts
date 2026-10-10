/**
 * Third-party measurement identifiers of a page (ADR 0017): the rules the application shares with
 * the database (public.set_profile_pixels and the profile_pixels checks). Identifiers only. The
 * product never accepts a script, a snippet or a tag-manager container: what runs on the public
 * page is the product's own loader, pointed at two fixed vendor addresses.
 */
export const META_PIXEL_ID_PATTERN = /^[0-9]{10,20}$/;
/** Google Analytics 4 measurement ID. Tag Manager containers (GTM-…) are refused on purpose: a container runs arbitrary scripts. */
export const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{6,14}$/;

export type PixelField = "meta" | "ga";

export interface PixelsInput {
  metaPixelId: string | null;
  gaMeasurementId: string | null;
}

export type PixelsInputResult = { ok: true; value: PixelsInput } | { ok: false; field: PixelField };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Empty clears an identifier. Mirror of the normalization in public.set_profile_pixels. */
export function parsePixelsInput(raw: { meta: unknown; ga: unknown }): PixelsInputResult {
  const meta = text(raw.meta);
  const ga = text(raw.ga).toUpperCase();
  if (meta !== "" && !META_PIXEL_ID_PATTERN.test(meta)) return { ok: false, field: "meta" };
  if (ga !== "" && !GA_MEASUREMENT_ID_PATTERN.test(ga)) return { ok: false, field: "ga" };
  return { ok: true, value: { metaPixelId: meta || null, gaMeasurementId: ga || null } };
}

/** What the public page receives: only identifiers that pass the patterns, or null when there is none. */
export interface PublicPixels {
  meta?: string;
  ga?: string;
}

export function parsePublicPixels(value: unknown): PublicPixels | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pixels: PublicPixels = {};
  if (typeof record.meta === "string" && META_PIXEL_ID_PATTERN.test(record.meta)) pixels.meta = record.meta;
  if (typeof record.ga === "string" && GA_MEASUREMENT_ID_PATTERN.test(record.ga)) pixels.ga = record.ga;
  return pixels.meta || pixels.ga ? pixels : null;
}
