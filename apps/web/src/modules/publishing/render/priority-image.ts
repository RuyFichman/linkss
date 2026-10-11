import type { PublishedBlock } from "../document";

/**
 * How many leading blocks can share the first screen of a phone with the header. Measured on
 * staging (2026-10-02): with a form first, the image in the second block was the LCP element and
 * still lazy, so the browser only fetched it after layout.
 */
export const PRIORITY_IMAGE_WINDOW = 3;

/**
 * The image most likely to be the LCP element: the first image among the leading blocks. Only one
 * image gets eager loading and high fetch priority; images further down stay lazy, so a page with
 * many images still costs one image above the fold.
 */
export function priorityImageId(blocks: readonly PublishedBlock[]): string | null {
  return blocks.slice(0, PRIORITY_IMAGE_WINDOW).find((block) => block.type === "image")?.id ?? null;
}
