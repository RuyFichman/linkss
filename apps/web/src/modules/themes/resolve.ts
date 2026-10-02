import { AA_COMPONENT_CONTRAST, AA_TEXT_CONTRAST, contrastRatio, mixColors, mutedTextColor, readableTextColor } from "./contrast";
import { CORNER_RADIUS_PX, SPACING_GAP_PX, type ThemeFont, type ThemeTokens } from "./tokens";

/**
 * Everything the renderer needs to paint a page: concrete colors and sizes derived from the tokens.
 * Text colors are always computed here (ADR 0010), so no combination of tokens is unreadable.
 */
export interface ResolvedTheme {
  pageBackground: string;
  pageText: string;
  pageMuted: string;
  buttonBackground: string;
  buttonText: string;
  buttonBorder: string;
  buttonHoverBackground: string;
  buttonHoverBorder: string;
  /** Background of an icon under the pointer. */
  iconHoverBackground: string;
  /** Boxes that hold a key or a form: a readable surface on any page background. */
  surfaceBackground: string;
  surfaceText: string;
  surfaceMuted: string;
  surfaceBorder: string;
  /** Avatar placeholder and small highlights. */
  accentBackground: string;
  accentText: string;
  divider: string;
  radiusPx: number;
  gapPx: number;
  font: ThemeFont;
}

/** The look of every page until Sprint 4, reproduced value by value (ADR 0010). */
export const CLASSIC_THEME: ResolvedTheme = {
  pageBackground: "#f5f6fa",
  pageText: "#171a22",
  pageMuted: "#596171",
  buttonBackground: "#ffffff",
  buttonText: "#171a22",
  buttonBorder: "#d7dce5",
  buttonHoverBackground: "#eef1f7",
  buttonHoverBorder: "#3156d3",
  iconHoverBackground: "#eef1f7",
  surfaceBackground: "#ffffff",
  surfaceText: "#171a22",
  surfaceMuted: "#596171",
  surfaceBorder: "#d7dce5",
  accentBackground: "#3156d3",
  accentText: "#ffffff",
  divider: "#d7dce5",
  radiusPx: 16,
  gapPx: 12,
  font: "system",
};

function buttonColors(tokens: ThemeTokens, pageText: string): Pick<ResolvedTheme, "buttonBackground" | "buttonText" | "buttonBorder" | "buttonHoverBackground" | "buttonHoverBorder"> {
  const { background, button } = tokens;
  // Hover never lowers the label's contrast: a filled button moves away from its label color, the
  // other styles keep their background and strengthen the border.
  switch (tokens.buttonStyle) {
    case "filled": {
      const text = readableTextColor(button);
      const hover = mixColors(text === "#ffffff" ? "#000000" : "#ffffff", button, 0.12);
      return { buttonBackground: button, buttonText: text, buttonBorder: button, buttonHoverBackground: hover, buttonHoverBorder: hover };
    }
    case "outline": {
      // The label sits on the page background: the button color is used only when it is readable there.
      const text = contrastRatio(button, background) >= AA_TEXT_CONTRAST ? button : pageText;
      return { buttonBackground: background, buttonText: text, buttonBorder: button, buttonHoverBackground: background, buttonHoverBorder: text };
    }
    case "soft": {
      const fill = mixColors(button, background, 0.16);
      const text = readableTextColor(fill);
      return { buttonBackground: fill, buttonText: text, buttonBorder: mixColors(button, background, 0.3), buttonHoverBackground: fill, buttonHoverBorder: text };
    }
  }
}

/** Derives the full palette. `null` is the classic look. */
export function resolveTheme(tokens: ThemeTokens | null): ResolvedTheme {
  if (!tokens) return CLASSIC_THEME;
  const pageText = readableTextColor(tokens.background);
  const surfaceBackground = mixColors(pageText, tokens.background, 0.06);
  const surfaceText = readableTextColor(surfaceBackground);
  return {
    pageBackground: tokens.background,
    pageText,
    pageMuted: mutedTextColor(pageText, tokens.background),
    ...buttonColors(tokens, pageText),
    iconHoverBackground: surfaceBackground,
    surfaceBackground,
    surfaceText,
    surfaceMuted: mutedTextColor(surfaceText, surfaceBackground),
    surfaceBorder: mixColors(pageText, tokens.background, 0.22),
    accentBackground: tokens.button,
    accentText: readableTextColor(tokens.button),
    divider: mixColors(pageText, tokens.background, 0.22),
    radiusPx: CORNER_RADIUS_PX[tokens.corners],
    gapPx: SPACING_GAP_PX[tokens.spacing],
    font: tokens.font,
  };
}

export interface ThemeReport {
  /** Contrast of the page text on the background (always at least 4.5). */
  textContrast: number;
  /** Contrast of the button label on the button (always at least 4.5). */
  buttonTextContrast: number;
  /** True when the button is hard to tell from the page (below 3:1): shown as advice, never a block. */
  buttonBlendsIn: boolean;
  /** True when an outline button could not use its own color for the label. */
  outlineLabelAdjusted: boolean;
}

/** What the editor tells the person about the current choice, in words (never by color alone). */
export function themeReport(tokens: ThemeTokens): ThemeReport {
  const resolved = resolveTheme(tokens);
  const boundary = tokens.buttonStyle === "soft" ? resolved.buttonBorder : tokens.button;
  return {
    textContrast: contrastRatio(resolved.pageText, resolved.pageBackground),
    buttonTextContrast: contrastRatio(resolved.buttonText, resolved.buttonBackground),
    buttonBlendsIn: contrastRatio(boundary, tokens.background) < AA_COMPONENT_CONTRAST,
    outlineLabelAdjusted: tokens.buttonStyle === "outline" && resolved.buttonText !== tokens.button,
  };
}
