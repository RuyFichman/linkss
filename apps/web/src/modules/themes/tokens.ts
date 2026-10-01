import { isHexColor } from "./contrast";

/**
 * Theme tokens (ADR 0010): a closed set, stored in profiles.theme and copied into the snapshot.
 * `null` means the classic look every page had before Sprint 5. Mirror of private.is_valid_theme().
 * There is no free-form value besides the two colors, and those must be `#rrggbb`.
 */
export const BUTTON_STYLES = ["filled", "outline", "soft"] as const;
export const CORNER_STYLES = ["square", "rounded", "pill"] as const;
export const SPACING_STYLES = ["compact", "regular", "relaxed"] as const;
export const THEME_FONTS = ["system", "serif", "poppins", "lora"] as const;

export type ButtonStyle = (typeof BUTTON_STYLES)[number];
export type CornerStyle = (typeof CORNER_STYLES)[number];
export type SpacingStyle = (typeof SPACING_STYLES)[number];
export type ThemeFont = (typeof THEME_FONTS)[number];

export interface ThemeTokens {
  background: string;
  button: string;
  buttonStyle: ButtonStyle;
  corners: CornerStyle;
  spacing: SpacingStyle;
  font: ThemeFont;
}

/** Pixel values behind the enumerations; the renderer never receives a number from storage. */
export const CORNER_RADIUS_PX: Record<CornerStyle, number> = { square: 4, rounded: 16, pill: 28 };
export const SPACING_GAP_PX: Record<SpacingStyle, number> = { compact: 8, regular: 12, relaxed: 20 };

const THEME_KEYS = ["background", "button", "buttonStyle", "corners", "font", "spacing"] as const;

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Strict check of a stored theme: exact keys, enumerated values, lowercase hex colors. */
export function isValidTheme(value: unknown): value is ThemeTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const theme = value as Record<string, unknown>;
  const keys = Object.keys(theme).sort();
  if (keys.length !== THEME_KEYS.length || keys.some((key, index) => key !== THEME_KEYS[index])) return false;
  return isHexColor(theme.background) && isHexColor(theme.button) && oneOf(BUTTON_STYLES, theme.buttonStyle)
    && oneOf(CORNER_STYLES, theme.corners) && oneOf(SPACING_STYLES, theme.spacing) && oneOf(THEME_FONTS, theme.font);
}

/** Tolerant reader: anything that is not a valid theme is the classic look (never a broken page). */
export function readTheme(value: unknown): ThemeTokens | null {
  return isValidTheme(value) ? cloneTheme(value) : null;
}

/** Copy with keys in a fixed order and no extra properties. */
export function cloneTheme(theme: ThemeTokens): ThemeTokens {
  return { background: theme.background, button: theme.button, buttonStyle: theme.buttonStyle, corners: theme.corners, spacing: theme.spacing, font: theme.font };
}

export function themesEqual(first: ThemeTokens | null, second: ThemeTokens | null): boolean {
  if (first === null || second === null) return first === second;
  return THEME_KEYS.every((key) => first[key] === second[key]);
}

/**
 * Starting point when a person begins customizing a page that has the classic look: the same
 * colors and shapes, expressed as tokens.
 */
export const CLASSIC_AS_TOKENS: ThemeTokens = { background: "#f5f6fa", button: "#3156d3", buttonStyle: "filled", corners: "rounded", spacing: "regular", font: "system" };
