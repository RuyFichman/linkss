import type { Viewport } from "next";
import { imageSources, type ImageSources } from "@/modules/media/url";
import { resolveTheme } from "@/modules/themes/resolve";
import type { PublishedDocument } from "../document";
import type { PublicPageResult } from "../public-page";
import { priorityImageId } from "./priority-image";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The page's own background color, for the parts of the screen the page does not paint: the
 * browser's status and tool bars on a phone and the area revealed by overscroll. Without it they
 * take the product's light background, which shows as a band above and below a dark page.
 * Only a plain hex color is returned, because the value is written into a style rule.
 */
export function pageChromeColor(document: PublishedDocument): string | null {
  const color = resolveTheme(document.theme).pageBackground;
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

/** `theme-color` for a public route; nothing for a page that is not on the air. */
export function publicPageViewport(result: PublicPageResult): Viewport {
  const color = result.state === "published" ? pageChromeColor(result.document) : null;
  return color ? { themeColor: color } : {};
}

/**
 * Sources of the image most likely to be the largest element of the first screen (the same one
 * the renderer marks eager), so the route can ask the browser for it from the document head,
 * before it reaches the `<img>` in the body. `null` when no image is among the leading blocks.
 */
export function priorityImagePreload(document: PublishedDocument): ImageSources | null {
  const id = priorityImageId(document.blocks);
  const block = document.blocks.find((item) => item.id === id);
  return block && block.type === "image" ? imageSources(block.mediaId, block.width) : null;
}
