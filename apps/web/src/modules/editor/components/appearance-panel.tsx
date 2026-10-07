"use client";

import { useEffect, useRef, useState } from "react";
import { THEME_COPY } from "@/content/pt-BR";
import { normalizeHexColor } from "@/modules/themes/contrast";
import { resolveTheme, themeReport } from "@/modules/themes/resolve";
import { TEMPLATES, type TemplateDefinition } from "@/modules/themes/templates";
import { BUTTON_STYLES, CLASSIC_AS_TOKENS, CORNER_STYLES, SPACING_STYLES, THEME_FONTS, themesEqual, type ThemeTokens } from "@/modules/themes/tokens";
import { Badge, Button, Dialog, DialogActions, SelectField } from "@/ui";
import type { AppliedTemplate } from "../draft/state";
import { StudioIcon, type StudioIconName } from "./studio-icons";

interface AppearancePanelProps {
  theme: ThemeTokens | null;
  hasBlocks: boolean;
  lastTemplate: AppliedTemplate | null;
  onSetTheme: (theme: ThemeTokens | null) => void;
  onApplyTemplate: (template: TemplateDefinition, withExamples: boolean) => void;
  onUndoTemplate: () => void;
}

const ratio = (value: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);

/** A color as a palette picker plus its code. Only a complete, valid code changes the theme. */
function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const [typed, setTyped] = useState<{ value: string; for: string } | null>(null);
  // What the person is typing wins until the stored color changes from somewhere else (palette, template).
  const text = typed && typed.for === value ? typed.value : value;
  const invalid = normalizeHexColor(text) === null;
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="ui-label mb-1 p-0">{label}</legend>
      <div className="flex items-center gap-2">
        <input type="color" className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-app-border bg-app-surface p-1" aria-label={THEME_COPY.fields.colorPicker(label)} value={value} onChange={(event) => { setTyped(null); onChange(event.target.value.toLowerCase()); }} />
        <input
          id={id}
          className="ui-input"
          aria-label={THEME_COPY.fields.colorCode(label)}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint`}
          value={text}
          maxLength={7}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value;
            const color = normalizeHexColor(next);
            // A valid code is applied at once; the field then shows the stored (normalized) color.
            if (color && next.replace(/^#/, "").length === 6) { setTyped(null); onChange(color); } else setTyped({ value: next, for: value });
          }}
          onBlur={() => setTyped(null)}
        />
      </div>
      <p id={`${id}-hint`} className={invalid ? "ui-error" : "ui-hint"} role={invalid ? "alert" : undefined}>{invalid ? THEME_COPY.fields.colorError : THEME_COPY.fields.colorHint}</p>
    </fieldset>
  );
}

function ChoiceGroup<Value extends string>({ name, legend, options, labels, value, onChange }: { name: string; legend: string; options: readonly Value[]; labels: Record<Value, string>; value: Value; onChange: (value: Value) => void }) {
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="ui-label mb-1 p-0">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 ${value === option ? "border-app-accent bg-app-accent-soft font-bold" : "border-app-border"}`}>
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
            {labels[option]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type StyleSection = "templates" | "colors" | "buttons" | "fonts";

const SECTION_ICON: Record<StyleSection, StudioIconName> = { templates: "templates", colors: "colors", buttons: "buttons", fonts: "fonts" };
/** Sections that edit theme tokens, with how many controls each holds. They need a theme of the page's own. */
const TOKEN_SECTIONS: readonly { id: Exclude<StyleSection, "templates">; count: number }[] = [{ id: "colors", count: 2 }, { id: "buttons", count: 2 }, { id: "fonts", count: 2 }];

/**
 * Theme controls and the template gallery (ADR 0010), as a list of sections that open one at a
 * time. Every change is an editor action, saved by the same autosave as the blocks and shown at
 * once in the preview. Text colors are derived, so the panel explains the result in words instead
 * of asking the person to judge contrast.
 */
export function AppearancePanel({ theme, hasBlocks, lastTemplate, onSetTheme, onApplyTemplate, onUndoTemplate }: AppearancePanelProps) {
  const [opened, setOpened] = useState<StyleSection | null>(null);
  const [pending, setPending] = useState<TemplateDefinition | null>(null);
  const [withExamples, setWithExamples] = useState(false);
  const pendingFocus = useRef<string | null>(null);
  const report = theme ? themeReport(theme) : null;
  const resolved = theme ? resolveTheme(theme) : null;
  const appliedTemplate = lastTemplate ? TEMPLATES.find((template) => template.id === lastTemplate.templateId) : undefined;
  const set = (patch: Partial<ThemeTokens>) => { if (theme) onSetTheme({ ...theme, ...patch }); };
  // Undoing a template can bring back the standard look while a token section is open.
  const section = opened !== null && opened !== "templates" && !theme ? null : opened;

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    document.getElementById(id)?.focus();
  }, [section]);

  function open(next: StyleSection | null) {
    pendingFocus.current = next ? "styles-back" : `styles-row-${section}`;
    setOpened(next);
  }

  function confirmTemplate() {
    if (!pending) return;
    onApplyTemplate(pending, withExamples && !hasBlocks);
    setPending(null);
    setWithExamples(false);
  }

  const row = (id: StyleSection, count: number) => (
    <li key={id} className="studio-row">
      <button type="button" id={`styles-row-${id}`} className="studio-row-main" onClick={() => open(id)}>
        <span className="studio-row-icon"><StudioIcon name={SECTION_ICON[id]} /></span>
        <span className="studio-row-text"><span className="studio-row-label">{THEME_COPY.sections[id]}</span></span>
        <span className="studio-row-count" aria-hidden="true">{count}</span>
        <span className="studio-row-icon"><StudioIcon name="chevron" size={18} /></span>
      </button>
    </li>
  );

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4" aria-labelledby="editor-appearance-title">
      <h2 id="editor-appearance-title" className="sr-only">{THEME_COPY.section}</h2>

      {section === null ? (
        <>
          <p className="studio-lead">{THEME_COPY.lead}</p>
          <ul className="studio-list">
            {row("templates", TEMPLATES.length)}
            {theme ? TOKEN_SECTIONS.map((item) => row(item.id, item.count)) : null}
          </ul>
          {theme && report && resolved ? (
            <>
              <div className="grid gap-1 rounded-lg border border-app-border bg-app-surface-soft p-3 text-sm" role="status" aria-live="polite">
                <p className="m-0 font-bold">{THEME_COPY.contrast.title}</p>
                <p className="m-0">{THEME_COPY.contrast.text(resolved.pageText === "#ffffff" ? THEME_COPY.contrast.textColors.light : THEME_COPY.contrast.textColors.dark, ratio(report.textContrast))}</p>
                <p className="m-0">{THEME_COPY.contrast.buttonText(ratio(report.buttonTextContrast))}</p>
                {report.outlineLabelAdjusted ? <p className="m-0">{THEME_COPY.contrast.outlineAdjusted}</p> : null}
                {report.buttonBlendsIn ? <p className="m-0 font-bold text-app-warning">{THEME_COPY.contrast.buttonBlendsIn}</p> : null}
              </div>
              <div><Button type="button" variant="ghost" id="theme-reset" onClick={() => onSetTheme(null)}>{THEME_COPY.reset}</Button></div>
            </>
          ) : (
            <div className="grid gap-3">
              <p className="studio-lead">{THEME_COPY.usingClassic}</p>
              <div><Button type="button" variant="secondary" id="theme-customize" onClick={() => onSetTheme(CLASSIC_AS_TOKENS)}>{THEME_COPY.customize}</Button></div>
            </div>
          )}
        </>
      ) : (
        <button type="button" id="styles-back" className="studio-back" aria-label={THEME_COPY.back(THEME_COPY.sections[section])} onClick={() => open(null)}>
          <StudioIcon name="back" size={18} />{THEME_COPY.sections[section]}
        </button>
      )}

      {section === "templates" ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <p className="studio-lead">{THEME_COPY.templates.lead}</p>
          {appliedTemplate ? (
            <p className="m-0 flex flex-wrap items-center gap-3 rounded-lg border border-app-border bg-app-surface-soft p-3" role="status">
              <span className="font-bold">{THEME_COPY.templates.applied(appliedTemplate.name)}</span>
              <Button type="button" id="template-undo" variant="secondary" onClick={onUndoTemplate}>{THEME_COPY.templates.undo}</Button>
            </p>
          ) : null}
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0">
            {TEMPLATES.map((template) => {
              const colors = resolveTheme(template.theme);
              const inUse = themesEqual(theme, template.theme);
              return (
                <li key={template.id} className="studio-tile" data-current={inUse ? "" : undefined}>
                  {/* Decorative sample of the template's colors; its name and description say what it is. */}
                  <div aria-hidden="true" className="grid gap-2 rounded-md border border-app-border p-3" style={{ background: colors.pageBackground }}>
                    <span className="mx-auto block h-6 w-6 rounded-full" style={{ background: colors.pageText }} />
                    <span className="mx-auto block h-1.5 w-14 rounded-full" style={{ background: colors.pageText }} />
                    <span className="block h-6 w-full border" style={{ background: colors.buttonBackground, borderColor: colors.buttonBorder, borderRadius: Math.min(colors.radiusPx, 12) }} />
                    <span className="block h-6 w-full border" style={{ background: colors.buttonBackground, borderColor: colors.buttonBorder, borderRadius: Math.min(colors.radiusPx, 12) }} />
                  </div>
                  <div className="grid gap-1">
                    <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-bold">{template.name}{inUse ? <Badge tone="success">{THEME_COPY.templates.inUse}</Badge> : null}</p>
                    <p className="studio-row-note m-0">{template.description}</p>
                  </div>
                  <div className="self-end"><Button type="button" variant="secondary" className="w-full" id={`template-${template.id}`} aria-label={THEME_COPY.templates.applyLabel(template.name)} onClick={() => setPending(template)}>{THEME_COPY.templates.apply}</Button></div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {theme && section === "colors" ? (
        <>
          <div className="studio-group"><div className="studio-group-body"><ColorField id="theme-background" label={THEME_COPY.fields.background} value={theme.background} onChange={(background) => set({ background })} /></div></div>
          <div className="studio-group"><div className="studio-group-body"><ColorField id="theme-button" label={THEME_COPY.fields.button} value={theme.button} onChange={(button) => set({ button })} /></div></div>
        </>
      ) : null}

      {theme && section === "buttons" ? (
        <div className="studio-group">
          <div className="studio-group-body">
            <ChoiceGroup name="theme-button-style" legend={THEME_COPY.fields.buttonStyle} options={BUTTON_STYLES} labels={THEME_COPY.buttonStyles} value={theme.buttonStyle} onChange={(buttonStyle) => set({ buttonStyle })} />
            <ChoiceGroup name="theme-corners" legend={THEME_COPY.fields.corners} options={CORNER_STYLES} labels={THEME_COPY.corners} value={theme.corners} onChange={(corners) => set({ corners })} />
          </div>
        </div>
      ) : null}

      {theme && section === "fonts" ? (
        <div className="studio-group">
          <div className="studio-group-body">
            <SelectField id="theme-font" label={THEME_COPY.fields.font} value={theme.font} onChange={(event) => { const font = THEME_FONTS.find((item) => item === event.target.value); if (font) set({ font }); }}>
              {THEME_FONTS.map((font) => <option key={font} value={font}>{THEME_COPY.fonts[font]}</option>)}
            </SelectField>
            <ChoiceGroup name="theme-spacing" legend={THEME_COPY.fields.spacing} options={SPACING_STYLES} labels={THEME_COPY.spacing} value={theme.spacing} onChange={(spacing) => set({ spacing })} />
          </div>
        </div>
      ) : null}

      <Dialog open={pending !== null} onClose={() => setPending(null)} title={pending ? THEME_COPY.templates.confirmTitle(pending.name) : ""}>
        <div className="grid gap-3">
          <p className="m-0">{THEME_COPY.templates.changes}</p>
          <p className="m-0 font-bold">{THEME_COPY.templates.keeps}</p>
          {!hasBlocks ? (
            <div className="grid gap-1 rounded-xl border border-app-border p-3">
              <label className="flex min-h-11 items-center gap-3 font-bold">
                <input className="h-5 w-5" type="checkbox" checked={withExamples} aria-describedby="template-examples-hint" onChange={(event) => setWithExamples(event.target.checked)} />
                {THEME_COPY.templates.examples}
              </label>
              <p id="template-examples-hint" className="ui-hint">{THEME_COPY.templates.examplesHint}</p>
            </div>
          ) : null}
        </div>
        <DialogActions>
          <Button type="button" variant="secondary" onClick={() => setPending(null)}>{THEME_COPY.templates.cancel}</Button>
          <Button type="button" onClick={confirmTemplate}>{THEME_COPY.templates.confirm}</Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}
