import localFont from "next/font/local";
import type { ThemeFont } from "./tokens";

/**
 * Curated theme fonts (ADR 0010). Two system stacks cost nothing; two families are self-hosted
 * (SIL Open Font License, latin subset, files in ./fonts with their licenses):
 *   - Poppins 400 + 700: 7.9 KB + 7.8 KB
 *   - Lora variable 400–700: 37.8 KB
 * `preload: false`: a page downloads a file only when its theme uses that family. `display: swap`
 * with a metric-adjusted fallback keeps the text visible and the layout still while it loads.
 * No font URL is ever taken from stored data.
 */
const poppins = localFont({
  src: [
    { path: "./fonts/poppins-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/poppins-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});

const lora = localFont({
  src: "./fonts/lora-latin-wght-normal.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});

export const THEME_FONT_FAMILY: Record<ThemeFont, string> = {
  system: "Arial, Helvetica, sans-serif",
  serif: 'Georgia, "Times New Roman", serif',
  poppins: `${poppins.style.fontFamily}, Arial, Helvetica, sans-serif`,
  lora: `${lora.style.fontFamily}, Georgia, serif`,
};
