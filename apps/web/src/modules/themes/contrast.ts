/** WCAG 2.x color math for theme derivation (ADR 0010). Colors are `#rrggbb`, lowercase. */
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

/** Accepts "#RGB", "#RRGGBB" or the same without "#", in any case; returns "#rrggbb" or null. */
export function normalizeHexColor(input: string): string | null {
  const value = input.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(value)) return `#${[...value].map((character) => character + character).join("")}`;
  return /^[0-9a-f]{6}$/.test(value) ? `#${value}` : null;
}

function channels(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** Contrast ratio between two colors, from 1 (equal) to 21 (black on white). */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `weight` of `color` over `base` (0 = base, 1 = color), mixed in sRGB like CSS color-mix. */
export function mixColors(color: string, base: string, weight: number): string {
  const from = channels(color);
  const to = channels(base);
  return `#${from.map((channel, index) => Math.round(channel * weight + (to[index] ?? 0) * (1 - weight)).toString(16).padStart(2, "0")).join("")}`;
}

export const AA_TEXT_CONTRAST = 4.5;
/** WCAG 1.4.11: boundary of a control against what is around it. */
export const AA_COMPONENT_CONTRAST = 3;

const INK = "#171a22";
const WHITE = "#ffffff";
const BLACK = "#000000";

/**
 * Readable text color for a background: the product's ink or white, whichever contrasts more, and
 * pure black in the narrow band of mid-tones where neither reaches 4.5:1. The result is at least
 * 4.5:1 for every possible background (property-tested).
 */
export function readableTextColor(background: string): string {
  const best = contrastRatio(INK, background) >= contrastRatio(WHITE, background) ? INK : WHITE;
  return contrastRatio(best, background) >= AA_TEXT_CONTRAST ? best : BLACK;
}

/**
 * Secondary text: the main text softened toward the background as far as 4.5:1 allows. Falls back
 * to the main text color when no softer tone is readable.
 */
export function mutedTextColor(text: string, background: string): string {
  for (const weight of [0.72, 0.8, 0.88]) {
    const candidate = mixColors(text, background, weight);
    if (contrastRatio(candidate, background) >= AA_TEXT_CONTRAST) return candidate;
  }
  return text;
}
