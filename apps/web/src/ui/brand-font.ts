import { Schibsted_Grotesk } from "next/font/google";

/**
 * Display face of the product (the one the marketing home uses), self-hosted by next/font. Layouts
 * put `brandFont.variable` next to the `brand` class (globals.css); the public page never loads it.
 */
export const brandFont = Schibsted_Grotesk({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-brand-display", display: "swap" });

/** Class list for a layout root that wears the product look. */
export const BRAND_CLASS = `brand ${brandFont.variable}`;
