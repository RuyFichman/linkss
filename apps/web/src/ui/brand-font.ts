import { Schibsted_Grotesk } from "next/font/google";

/**
 * Typeface of the product (the display face of the marketing home), self-hosted by next/font. Layouts
 * put `brandFont.variable` next to the `brand` class (globals.css); the public page never loads it.
 * Inside `brand` it is the text face too, so it carries the text weights; the home keeps its own.
 */
export const brandFont = Schibsted_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-brand-display", display: "swap" });

/** Class list for a layout root that wears the product look. */
export const BRAND_CLASS = `brand ${brandFont.variable}`;
