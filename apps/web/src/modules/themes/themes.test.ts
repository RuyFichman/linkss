import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_BLOCKS, validateBlockInput, type DraftBlock } from "@/modules/blocks";
import { blocksByteSize } from "@/modules/blocks/model";
import { MAX_BLOCKS_BYTES } from "@/modules/blocks/limits";
import { checkDraft, editorReducer, editorStateFromDraft, type EditorState } from "@/modules/editor/draft/state";
import { applyTemplate } from "./apply-template";
import { AA_TEXT_CONTRAST, contrastRatio, mixColors, mutedTextColor, normalizeHexColor, readableTextColor } from "./contrast";
import { CLASSIC_THEME, resolveTheme, themeReport } from "./resolve";
import { TEMPLATE_IDS, TEMPLATES } from "./templates";
import { BUTTON_STYLES, CORNER_RADIUS_PX, CORNER_STYLES, isValidTheme, readTheme, SPACING_GAP_PX, SPACING_STYLES, THEME_FONTS, type ThemeTokens } from "./tokens";

const THEME: ThemeTokens = { background: "#f5efe5", button: "#1f5b49", buttonStyle: "filled", corners: "rounded", spacing: "regular", font: "serif" };
const id = (n: number) => `6f1c1d2e-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A spread of colors: grays, primaries, pastels and every mid-tone where black and white are close. */
function colorGrid(): string[] {
  const steps = [0, 51, 102, 119, 128, 153, 204, 255];
  const colors: string[] = [];
  for (const red of steps) for (const green of steps) for (const blue of steps) colors.push(`#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`);
  return colors;
}

describe("contrast math", () => {
  it("matches the ratios measured in docs/ux/DESIGN_TOKENS.md", () => {
    expect(contrastRatio("#171a22", "#ffffff")).toBeCloseTo(17.39, 1);
    expect(contrastRatio("#596171", "#ffffff")).toBeCloseTo(6.23, 1);
    expect(contrastRatio("#ffffff", "#3156d3")).toBeCloseTo(6.17, 1);
    expect(contrastRatio("#231f1a", "#f5efe5")).toBeCloseTo(14.32, 1);
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#3156d3", "#3156d3")).toBe(1);
  });

  it("normalizes typed colors and refuses anything else", () => {
    expect(normalizeHexColor(" #1F5B49 ")).toBe("#1f5b49");
    expect(normalizeHexColor("abc")).toBe("#aabbcc");
    for (const value of ["", "#12", "red", "rgb(0,0,0)", "#1f5b4g", "url(javascript:alert(1))", "#1f5b49;background:url(x)", "var(--x)"]) expect(normalizeHexColor(value), value).toBeNull();
  });

  it("always finds a readable text color, for every background", () => {
    for (const background of colorGrid()) {
      const text = readableTextColor(background);
      expect(contrastRatio(text, background), background).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
      expect(contrastRatio(mutedTextColor(text, background), background), background).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    }
  });

  it("mixes colors like CSS color-mix in sRGB", () => {
    expect(mixColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixColors("#1f5b49", "#f5efe5", 0)).toBe("#f5efe5");
    expect(mixColors("#1f5b49", "#f5efe5", 1)).toBe("#1f5b49");
  });
});

describe("theme tokens", () => {
  it("accepts only the closed token set", () => {
    expect(isValidTheme(THEME)).toBe(true);
    const forged: unknown[] = [
      null, [], "theme",
      { ...THEME, background: "#F5EFE5" },
      { ...THEME, background: "red" },
      { ...THEME, background: "#fff" },
      { ...THEME, button: "url(javascript:alert(1))" },
      { ...THEME, button: "#1f5b49;}body{display:none" },
      { ...THEME, buttonStyle: "gradient" },
      { ...THEME, corners: "9999px" },
      { ...THEME, spacing: 12 },
      { ...THEME, font: "https://evil.example/font.woff2" },
      { ...THEME, font: "Comic Sans" },
      { ...THEME, css: "body{display:none}" },
      { ...THEME, backgroundImage: "https://evil.example/x.png" },
      { background: "#f5efe5", button: "#1f5b49" },
    ];
    for (const theme of forged) expect(isValidTheme(theme), JSON.stringify(theme)).toBe(false);
    expect(readTheme({ ...THEME, css: "x" })).toBeNull();
    expect(readTheme(THEME)).toEqual(THEME);
  });

  it("maps every enumeration to a fixed size", () => {
    expect(CORNER_STYLES.map((style) => CORNER_RADIUS_PX[style])).toEqual([4, 16, 28]);
    expect(SPACING_STYLES.map((style) => SPACING_GAP_PX[style])).toEqual([8, 12, 20]);
    expect(THEME_FONTS).toEqual(["system", "serif", "poppins", "lora"]);
  });

  it("matches private.is_valid_theme (drift guard)", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../../../supabase/migrations/202610010002_media_themes_forms.sql", import.meta.url)), "utf8");
    const body = /create function private\.is_valid_theme[\s\S]*?\$\$;/.exec(sql)?.[0] ?? "";
    const list = (key: string) => [...(new RegExp(`'${key}' in \\(([^)]+)\\)`).exec(body)?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
    expect(list("buttonStyle")).toEqual([...BUTTON_STYLES]);
    expect(list("corners")).toEqual([...CORNER_STYLES]);
    expect(list("spacing")).toEqual([...SPACING_STYLES]);
    expect(list("font")).toEqual([...THEME_FONTS]);
  });
});

describe("resolved theme", () => {
  it("reproduces the classic look when there is no theme", () => {
    expect(resolveTheme(null)).toBe(CLASSIC_THEME);
    expect(CLASSIC_THEME).toMatchObject({ pageBackground: "#f5f6fa", pageText: "#171a22", pageMuted: "#596171", buttonBackground: "#ffffff", buttonBorder: "#d7dce5", radiusPx: 16, gapPx: 12, font: "system" });
  });

  it("keeps every text readable for every color pair and button style, hover included", () => {
    const colors = colorGrid().filter((_, index) => index % 7 === 0);
    for (const background of colors) {
      for (const button of colors) {
        for (const buttonStyle of BUTTON_STYLES) {
          const theme = resolveTheme({ ...THEME, background, button, buttonStyle });
          const label = `${background} ${button} ${buttonStyle}`;
          expect(contrastRatio(theme.pageText, theme.pageBackground), label).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
          expect(contrastRatio(theme.pageMuted, theme.pageBackground), label).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
          expect(contrastRatio(theme.buttonText, theme.buttonBackground), label).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
          expect(contrastRatio(theme.buttonText, theme.buttonHoverBackground), label).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
          expect(contrastRatio(theme.surfaceText, theme.surfaceBackground), label).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
          expect(contrastRatio(theme.surfaceMuted, theme.surfaceBackground), label).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
          expect(contrastRatio(theme.accentText, theme.accentBackground), label).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
        }
      }
    }
  });

  it("reports in words when a button blends into the page or an outline label had to change", () => {
    expect(themeReport(THEME)).toMatchObject({ buttonBlendsIn: false, outlineLabelAdjusted: false });
    expect(themeReport({ ...THEME, button: "#f0eadf" }).buttonBlendsIn).toBe(true);
    const outline = themeReport({ ...THEME, button: "#f2cf4a", buttonStyle: "outline" });
    expect(outline.outlineLabelAdjusted).toBe(true);
    expect(outline.buttonTextContrast).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    expect(themeReport(THEME).textContrast).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
  });
});

describe("templates", () => {
  it("ships the five Sprint 1 templates with valid themes and example blocks", () => {
    expect(TEMPLATES.map((template) => template.id)).toEqual([...TEMPLATE_IDS]);
    expect(TEMPLATES).toHaveLength(5);
    for (const template of TEMPLATES) {
      expect(isValidTheme(template.theme), template.id).toBe(true);
      expect(template.name.length, template.id).toBeGreaterThan(0);
      expect(template.examples.length, template.id).toBeGreaterThan(0);
      expect(template.examples.length, template.id).toBeLessThanOrEqual(MAX_BLOCKS);
    }
  });

  it("never ships fake contact data: examples that need a phone, key or address start empty", () => {
    for (const template of TEMPLATES) {
      for (const input of template.examples) {
        if (input.type === "whatsapp") expect(input.phone).toBe("");
        if (input.type === "pix") expect(input.key).toBe("");
        if (input.type === "link" || input.type === "embed") expect(input.url).toBe("");
        if (input.type === "social") expect(input.items).toEqual({});
      }
      // Whatever is already valid fits the draft caps.
      const valid = template.examples.flatMap((input, index): DraftBlock[] => {
        const result = validateBlockInput(id(index), true, input);
        return result.ok ? [result.block] : [];
      });
      expect(blocksByteSize(valid)).toBeLessThan(MAX_BLOCKS_BYTES);
    }
  });
});

describe("apply template (AC3: no content is lost)", () => {
  const blocks: DraftBlock[] = [
    { id: id(1), type: "social", visible: true, items: [{ network: "instagram", url: "https://www.instagram.com/studio" }] },
    { id: id(2), type: "link", visible: false, title: "Oculto", url: "https://exemplo.com.br/" },
    { id: id(3), type: "image", visible: true, mediaId: "9a000000-0000-4000-8000-000000000001", width: 896, height: 672, alt: "Vitrine", decorative: false },
    { id: id(4), type: "embed", visible: true, provider: "youtube", ref: "dQw4w9WgXcQ", title: "Vídeo" },
    { id: id(5), type: "pix", visible: true, label: "Pix", keyType: "email", key: "ana@exemplo.com.br", paymentUrl: "" },
    { id: id(6), type: "form", visible: true, title: "Contato", fields: ["name", "email"], buttonLabel: "Enviar", consentText: "Aceito.", consentRequired: true },
    { id: id(7), type: "whatsapp", visible: true, label: "Zap", phone: "5511912345678", message: "Oi" },
    { id: id(8), type: "divider", visible: true },
  ];
  const page = { ...editorStateFromDraft({ title: "Studio Sprint", bio: "Bio da página", avatarPath: "9a000000-0000-4000-8000-0000000000aa", theme: THEME, blocks }), slug: "studio-sprint" };

  it.each(TEMPLATES)("$id changes the theme and nothing else on a page with content", (template) => {
    let counter = 100;
    const applied = applyTemplate(page, template, { withExamples: true, newId: () => id(counter++) });
    expect(applied.theme).toEqual(template.theme);
    // Same objects, same order: blocks and their visibility are not even copied.
    expect(applied.blocks).toBe(page.blocks);
    expect(applied.title).toBe("Studio Sprint");
    expect(applied.bio).toBe("Bio da página");
    expect(applied.avatarPath).toBe(page.avatarPath);
    expect(applied.slug).toBe("studio-sprint");
    expect({ ...applied, theme: null }).toEqual({ ...page, theme: null });
    // The template's own theme object is not shared with the page.
    expect(applied.theme).not.toBe(template.theme);
  });

  it.each(TEMPLATES)("$id adds examples only to an empty page and only when asked", (template) => {
    const empty = { ...page, blocks: [] as EditorState["blocks"] };
    let counter = 100;
    const withoutExamples = applyTemplate(empty, template, { withExamples: false, newId: () => id(counter++) });
    expect(withoutExamples.blocks).toBe(empty.blocks);
    const withExamples = applyTemplate(empty, template, { withExamples: true, newId: () => id(counter++) });
    expect(withExamples.blocks.map((block) => block.input.type)).toEqual(template.examples.map((input) => input.type));
    expect(new Set(withExamples.blocks.map((block) => block.id)).size).toBe(template.examples.length);
    expect(withExamples.blocks.every((block) => block.visible)).toBe(true);
    // Examples are copies: editing one cannot change the catalog.
    expect(withExamples.blocks[0]?.input).not.toBe(template.examples[0]);
  });

  it("is undoable in the editor: the previous theme comes back and the examples leave", () => {
    const initial: EditorState = editorStateFromDraft({ title: "Studio", bio: "", avatarPath: null, theme: THEME, blocks });
    const applied = editorReducer(initial, { type: "apply_template", templateId: "evento", withExamples: true, ids: [id(50), id(51), id(52), id(53)] });
    expect(applied.theme).toEqual(TEMPLATES[4]?.theme);
    expect(applied.blocks).toEqual(initial.blocks);
    expect(applied.lastTemplate).toEqual({ templateId: "evento", previousTheme: THEME, exampleIds: [] });
    const check = checkDraft(applied);
    expect(check.ok && check.draft.blocks).toEqual(blocks);
    expect(editorReducer(applied, { type: "undo_template" })).toMatchObject({ theme: THEME, blocks: initial.blocks, lastTemplate: null });

    const empty = editorStateFromDraft({ title: "Nova", bio: "", avatarPath: null, theme: null, blocks: [] });
    const seeded = editorReducer(empty, { type: "apply_template", templateId: "loja", withExamples: true, ids: [id(60), id(61), id(62)] });
    expect(seeded.blocks.map((block) => block.id)).toEqual([id(60), id(61), id(62)]);
    // Examples with empty contact fields are flagged and never saved as they are.
    expect(checkDraft(seeded).ok).toBe(false);
    expect(editorReducer(seeded, { type: "undo_template" })).toMatchObject({ theme: null, blocks: [], lastTemplate: null });
    // Not enough ids for the examples: nothing changes.
    expect(editorReducer(empty, { type: "apply_template", templateId: "loja", withExamples: true, ids: [id(60)] })).toBe(empty);
  });

  it("stores theme changes through the same draft as blocks", () => {
    const initial = editorStateFromDraft({ title: "Studio", bio: "", avatarPath: null, theme: null, blocks: [] });
    const themed = editorReducer(initial, { type: "set_theme", theme: THEME });
    const check = checkDraft(themed);
    expect(check.ok && check.draft.theme).toEqual(THEME);
    expect(editorReducer(themed, { type: "set_theme", theme: { ...THEME } })).toBe(themed);
    expect(editorReducer(themed, { type: "set_theme", theme: { ...THEME, font: "comic" } as unknown as ThemeTokens })).toBe(themed);
    expect(editorReducer(themed, { type: "set_theme", theme: null }).theme).toBeNull();
    const avatar = editorReducer(themed, { type: "set_avatar", mediaId: "9a000000-0000-4000-8000-0000000000aa" });
    const withAvatar = checkDraft(avatar);
    expect(withAvatar.ok && withAvatar.draft.avatarPath).toBe("9a000000-0000-4000-8000-0000000000aa");
  });
});
