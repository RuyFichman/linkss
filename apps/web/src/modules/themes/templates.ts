import { TEMPLATES_COPY } from "@/content/pt-BR";
import type { BlockInput } from "@/modules/blocks";
import type { ThemeTokens } from "./tokens";

/**
 * The five Sprint 1 templates as production data (ADR 0010). A template is a theme plus example
 * blocks. Examples are editor inputs, not stored blocks: anything that would need real contact
 * data (a phone, a Pix key, an address) is left empty, so no placeholder can be published by
 * accident. Names and texts live in content/pt-BR.ts.
 */
export const TEMPLATE_IDS = ["negocio-local", "criador", "profissional", "loja", "evento"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface TemplateDefinition {
  id: TemplateId;
  name: string;
  description: string;
  theme: ThemeTokens;
  examples: readonly BlockInput[];
}

const copy = TEMPLATES_COPY.items;

export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    id: "negocio-local", ...copy["negocio-local"].card,
    theme: { background: "#f5efe5", button: "#1f5b49", buttonStyle: "filled", corners: "rounded", spacing: "regular", font: "serif" },
    examples: [
      { type: "text", text: copy["negocio-local"].text },
      { type: "whatsapp", label: copy["negocio-local"].whatsappLabel, phone: "", message: copy["negocio-local"].whatsappMessage },
      { type: "link", title: copy["negocio-local"].linkTitle, url: "" },
    ],
  },
  {
    id: "criador", ...copy.criador.card,
    theme: { background: "#17142b", button: "#f2cf4a", buttonStyle: "filled", corners: "pill", spacing: "relaxed", font: "poppins" },
    examples: [
      { type: "embed", url: "", title: copy.criador.embedTitle },
      { type: "form", title: copy.criador.formTitle, fields: ["name", "email"], buttonLabel: copy.criador.formButton, consentText: copy.criador.formConsent, consentRequired: true },
      { type: "social", items: {} },
    ],
  },
  {
    id: "profissional", ...copy.profissional.card,
    theme: { background: "#eef5f2", button: "#225e50", buttonStyle: "outline", corners: "rounded", spacing: "regular", font: "lora" },
    examples: [
      { type: "text", text: copy.profissional.text },
      { type: "link", title: copy.profissional.linkTitle, url: "" },
      { type: "whatsapp", label: copy.profissional.whatsappLabel, phone: "", message: copy.profissional.whatsappMessage },
    ],
  },
  {
    id: "loja", ...copy.loja.card,
    theme: { background: "#fff8ed", button: "#c14c20", buttonStyle: "soft", corners: "square", spacing: "compact", font: "system" },
    examples: [
      { type: "link", title: copy.loja.linkTitle, url: "" },
      { type: "pix", label: copy.loja.pixLabel, keyType: "auto", key: "", paymentUrl: "" },
      { type: "whatsapp", label: copy.loja.whatsappLabel, phone: "", message: copy.loja.whatsappMessage },
    ],
  },
  {
    id: "evento", ...copy.evento.card,
    theme: { background: "#100f12", button: "#c21870", buttonStyle: "filled", corners: "square", spacing: "regular", font: "poppins" },
    examples: [
      { type: "link", title: copy.evento.linkTitle, url: "" },
      { type: "form", title: copy.evento.formTitle, fields: ["name", "email", "phone"], buttonLabel: copy.evento.formButton, consentText: copy.evento.formConsent, consentRequired: true },
      { type: "divider" },
      { type: "social", items: {} },
    ],
  },
];

export function findTemplate(id: unknown): TemplateDefinition | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
