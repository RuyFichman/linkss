import { BLOCKS_COPY } from "@/content/pt-BR";
import { EMBED_PROVIDERS, embedPageUrl, parseEmbedInput, type EmbedRejection } from "./embed";
import { orderFormFields, type FormField } from "./form";
import { codePointLength, EMBED_TITLE_MAX_LENGTH, FORM_BUTTON_MAX_LENGTH, FORM_CONSENT_MAX_LENGTH, FORM_TITLE_MAX_LENGTH, IMAGE_ALT_MAX_LENGTH, LINK_TITLE_MAX_LENGTH, PIX_LABEL_MAX_LENGTH, TEXT_MAX_LENGTH, WHATSAPP_LABEL_MAX_LENGTH, WHATSAPP_MESSAGE_MAX_LENGTH } from "./limits";
import { hasForbiddenLabelCharacters, hasForbiddenMultilineCharacters, isBlockId, normalizeLabel, normalizeMultiline, type BlockType, type DraftBlock } from "./model";
import { detectPixKeyType, formatPixKey, normalizePixKey, type PixKeyType } from "./pix";
import { normalizeSocialInput, SOCIAL_NETWORK_IDS, SOCIAL_NETWORKS, type SocialLink, type SocialNetwork } from "./social";
import { normalizeBlockUrl, type UrlRejection } from "./url-policy";
import { formatWhatsAppPhone, normalizeWhatsAppPhone } from "./whatsapp";

/** What the person types in each block form (raw strings, before normalization). */
export type BlockInput =
  | { type: "link"; title: string; url: string }
  | { type: "text"; text: string }
  | { type: "social"; items: Partial<Record<SocialNetwork, string>> }
  | { type: "whatsapp"; label: string; phone: string; message: string }
  | { type: "divider" }
  /** `mediaId` is "" until an upload finishes; the dimensions come from the server, never from typing. */
  | { type: "image"; mediaId: string; width: number; height: number; alt: string; decorative: boolean }
  /** `url` is the pasted address; only the provider and the id are stored. */
  | { type: "embed"; url: string; title: string }
  /** `keyType: "auto"` means "detect from the key". */
  | { type: "pix"; label: string; keyType: PixKeyType | "auto"; key: string; paymentUrl: string }
  | { type: "form"; title: string; fields: FormField[]; buttonLabel: string; consentText: string; consentRequired: boolean };

export type BlockField = "title" | "url" | "text" | "label" | "phone" | "message" | "image" | "alt" | "key" | "paymentUrl" | "fields" | "buttonLabel" | "consentText" | SocialNetwork;
export type BlockFieldErrors = Partial<Record<BlockField, string>>;

/** Non-blocking advice shown under a valid field (e.g. an http link). */
export type BlockNotices = Partial<Record<BlockField, string>>;

export type BlockValidation =
  | { ok: true; block: DraftBlock; notices: BlockNotices }
  | { ok: false; errors: BlockFieldErrors };

const URL_MESSAGES: Record<UrlRejection, string> = {
  required: BLOCKS_COPY.errors.url.required,
  scheme: BLOCKS_COPY.errors.url.scheme,
  relative: BLOCKS_COPY.errors.url.relative,
  whitespace: BLOCKS_COPY.errors.url.whitespace,
  credentials: BLOCKS_COPY.errors.url.credentials,
  host: BLOCKS_COPY.errors.url.host,
  email: BLOCKS_COPY.errors.url.email,
  phone: BLOCKS_COPY.errors.url.phone,
  too_long: BLOCKS_COPY.errors.url.tooLong,
};

const EMBED_MESSAGES: Record<EmbedRejection, string> = {
  required: BLOCKS_COPY.errors.embed.required,
  markup: BLOCKS_COPY.errors.embed.markup,
  address: BLOCKS_COPY.errors.embed.address,
  unknown_provider: BLOCKS_COPY.errors.embed.unknownProvider,
  unrecognized: BLOCKS_COPY.errors.embed.unrecognized,
};

export function urlRejectionMessage(reason: UrlRejection): string {
  return URL_MESSAGES[reason];
}

export function emptyBlockInput(type: BlockType): BlockInput {
  switch (type) {
    case "link": return { type, title: "", url: "" };
    case "text": return { type, text: "" };
    case "social": return { type, items: {} };
    case "whatsapp": return { type, label: "", phone: "", message: "" };
    case "divider": return { type };
    case "image": return { type, mediaId: "", width: 0, height: 0, alt: "", decorative: false };
    case "embed": return { type, url: "", title: "" };
    case "pix": return { type, label: BLOCKS_COPY.defaults.pixLabel, keyType: "auto", key: "", paymentUrl: "" };
    case "form": return { type, title: "", fields: ["name", "email"], buttonLabel: BLOCKS_COPY.defaults.formButton, consentText: BLOCKS_COPY.defaults.formConsent, consentRequired: true };
  }
}

/** Form values for an existing block (the stored forms, numbers and keys formatted for reading). */
export function blockToInput(block: DraftBlock): BlockInput {
  switch (block.type) {
    case "link": return { type: "link", title: block.title, url: block.url };
    case "text": return { type: "text", text: block.text };
    case "social": return { type: "social", items: Object.fromEntries(block.items.map((item) => [item.network, item.url])) };
    case "whatsapp": return { type: "whatsapp", label: block.label, phone: /^\d+$/.test(block.phone) ? formatWhatsAppPhone(block.phone) : block.phone, message: block.message };
    case "divider": return { type: "divider" };
    case "image": return { type: "image", mediaId: block.mediaId, width: block.width, height: block.height, alt: block.alt, decorative: block.decorative };
    case "embed": return { type: "embed", url: embedPageUrl(block.provider, block.ref) ?? block.ref, title: block.title };
    case "pix": return { type: "pix", label: block.label, keyType: block.keyType, key: formatPixKey(block.keyType, block.key), paymentUrl: block.paymentUrl };
    case "form": return { type: "form", title: block.title, fields: [...block.fields], buttonLabel: block.buttonLabel, consentText: block.consentText, consentRequired: block.consentRequired };
  }
}

function labelError(raw: string, max: number, lengthMessage: string = BLOCKS_COPY.errors.titleLength): string | undefined {
  if (hasForbiddenLabelCharacters(raw)) return BLOCKS_COPY.errors.controlCharacters;
  const value = normalizeLabel(raw);
  return codePointLength(value) < 1 || codePointLength(value) > max ? lengthMessage : undefined;
}

function multilineError(raw: string, min: number, max: number, lengthMessage: string): string | undefined {
  const value = normalizeMultiline(raw);
  if (hasForbiddenMultilineCharacters(value)) return BLOCKS_COPY.errors.controlCharacters;
  return codePointLength(value) < min || codePointLength(value) > max ? lengthMessage : undefined;
}

/** The key type that applies: the chosen one, or the one detected from the key. */
export function effectivePixKeyType(input: { keyType: PixKeyType | "auto"; key: string }): PixKeyType | null {
  return input.keyType === "auto" ? detectPixKeyType(input.key) : input.keyType;
}

/** Validates and normalizes one block form. The result is exactly what gets stored. */
export function validateBlockInput(id: string, visible: boolean, input: BlockInput): BlockValidation {
  const errors: BlockFieldErrors = {};
  const notices: BlockNotices = {};
  switch (input.type) {
    case "link": {
      const titleError = labelError(input.title, LINK_TITLE_MAX_LENGTH);
      if (titleError) errors.title = titleError;
      const url = normalizeBlockUrl(input.url);
      if (!url.ok) errors.url = urlRejectionMessage(url.reason);
      if (!url.ok || titleError) return { ok: false, errors };
      if (url.insecure) notices.url = BLOCKS_COPY.insecureLink;
      else if (url.punycode) notices.url = BLOCKS_COPY.punycodeNotice;
      return { ok: true, notices, block: { id, type: "link", visible, title: normalizeLabel(input.title), url: url.url } };
    }
    case "text": {
      const textError = multilineError(input.text, 1, TEXT_MAX_LENGTH, BLOCKS_COPY.errors.textLength);
      if (textError) return { ok: false, errors: { text: textError } };
      return { ok: true, notices, block: { id, type: "text", visible, text: normalizeMultiline(input.text) } };
    }
    case "social": {
      const items: SocialLink[] = [];
      for (const network of SOCIAL_NETWORK_IDS) {
        const raw = input.items[network];
        if (typeof raw !== "string" || raw.trim() === "") continue;
        const result = normalizeSocialInput(network, raw);
        if (result.ok) items.push({ network, url: result.url });
        else errors[network] = result.reason === "wrong_network" ? BLOCKS_COPY.errors.socialWrongNetwork(SOCIAL_NETWORKS[network].label) : BLOCKS_COPY.errors.social;
      }
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return { ok: true, notices, block: { id, type: "social", visible, items } };
    }
    case "whatsapp": {
      const labelProblem = labelError(input.label, WHATSAPP_LABEL_MAX_LENGTH);
      if (labelProblem) errors.label = labelProblem;
      const phone = normalizeWhatsAppPhone(input.phone);
      if (!phone.ok) errors.phone = BLOCKS_COPY.errors.whatsappPhone;
      const messageError = multilineError(input.message, 0, WHATSAPP_MESSAGE_MAX_LENGTH, BLOCKS_COPY.errors.messageLength);
      if (messageError) errors.message = messageError;
      if (!phone.ok || Object.keys(errors).length > 0) return { ok: false, errors };
      return { ok: true, notices, block: { id, type: "whatsapp", visible, label: normalizeLabel(input.label), phone: phone.phone, message: normalizeMultiline(input.message) } };
    }
    case "divider":
      return { ok: true, notices, block: { id, type: "divider", visible } };
    case "image": {
      if (!isBlockId(input.mediaId) || input.width < 1 || input.height < 1) errors.image = BLOCKS_COPY.errors.imageRequired;
      const altError = input.decorative ? undefined : labelError(input.alt, IMAGE_ALT_MAX_LENGTH, BLOCKS_COPY.errors.altLength);
      if (altError) errors.alt = altError;
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return { ok: true, notices, block: { id, type: "image", visible, mediaId: input.mediaId, width: input.width, height: input.height, alt: input.decorative ? "" : normalizeLabel(input.alt), decorative: input.decorative } };
    }
    case "embed": {
      const parsed = parseEmbedInput(input.url);
      if (!parsed.ok) errors.url = EMBED_MESSAGES[parsed.reason];
      const titleError = labelError(input.title, EMBED_TITLE_MAX_LENGTH);
      if (titleError) errors.title = titleError;
      if (!parsed.ok || titleError) return { ok: false, errors };
      notices.url = BLOCKS_COPY.embedRecognized(EMBED_PROVIDERS[parsed.provider].label);
      return { ok: true, notices, block: { id, type: "embed", visible, provider: parsed.provider, ref: parsed.ref, title: normalizeLabel(input.title) } };
    }
    case "pix": {
      const labelProblem = labelError(input.label, PIX_LABEL_MAX_LENGTH);
      if (labelProblem) errors.label = labelProblem;
      const keyType = effectivePixKeyType(input);
      const key = keyType ? normalizePixKey(keyType, input.key) : null;
      if (!keyType || key === null) errors.key = input.key.trim() === "" ? BLOCKS_COPY.errors.pixKeyRequired : input.keyType === "auto" ? BLOCKS_COPY.errors.pixKey : BLOCKS_COPY.errors.pixKeyForType(BLOCKS_COPY.pixKeyTypes[input.keyType]);
      let paymentUrl = "";
      if (input.paymentUrl.trim() !== "") {
        const url = normalizeBlockUrl(input.paymentUrl);
        if (!url.ok || url.kind !== "web" || url.insecure) errors.paymentUrl = BLOCKS_COPY.errors.paymentUrl;
        else paymentUrl = url.url;
      }
      if (!keyType || key === null || Object.keys(errors).length > 0) return { ok: false, errors };
      notices.key = keyType === "random" || keyType === "cnpj" ? BLOCKS_COPY.pixKeyPublic(BLOCKS_COPY.pixKeyTypes[keyType]) : BLOCKS_COPY.pixKeyPersonal(BLOCKS_COPY.pixKeyTypes[keyType]);
      return { ok: true, notices, block: { id, type: "pix", visible, label: normalizeLabel(input.label), keyType, key, paymentUrl } };
    }
    case "form": {
      const titleError = labelError(input.title, FORM_TITLE_MAX_LENGTH);
      if (titleError) errors.title = titleError;
      const fields = orderFormFields(input.fields);
      if (!fields.includes("email") && !fields.includes("phone")) errors.fields = BLOCKS_COPY.errors.formFields;
      const buttonError = labelError(input.buttonLabel, FORM_BUTTON_MAX_LENGTH, BLOCKS_COPY.errors.buttonLength);
      if (buttonError) errors.buttonLabel = buttonError;
      const consentError = labelError(input.consentText, FORM_CONSENT_MAX_LENGTH, BLOCKS_COPY.errors.consentLength);
      if (consentError) errors.consentText = consentError;
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return { ok: true, notices, block: { id, type: "form", visible, title: normalizeLabel(input.title), fields, buttonLabel: normalizeLabel(input.buttonLabel), consentText: normalizeLabel(input.consentText), consentRequired: input.consentRequired } };
    }
  }
}

function tidyLabel(value: string): string {
  return value.trim() ? normalizeLabel(value) : value;
}

/**
 * The input shown back after a field loses focus: each valid field in its normalized form
 * ("https://" added, number formatted); invalid fields stay as typed so the person can fix them.
 */
export function normalizedInput(input: BlockInput): BlockInput {
  switch (input.type) {
    case "link": {
      const url = normalizeBlockUrl(input.url);
      return { ...input, title: tidyLabel(input.title), url: url.ok ? url.url : input.url };
    }
    case "whatsapp": {
      const phone = normalizeWhatsAppPhone(input.phone);
      return { ...input, label: tidyLabel(input.label), phone: phone.ok ? formatWhatsAppPhone(phone.phone) : input.phone };
    }
    case "social": {
      const items: Partial<Record<SocialNetwork, string>> = {};
      for (const network of SOCIAL_NETWORK_IDS) {
        const raw = input.items[network];
        if (raw === undefined) continue;
        const result = raw.trim() ? normalizeSocialInput(network, raw) : null;
        items[network] = result?.ok ? result.url : raw;
      }
      return { ...input, items };
    }
    case "image":
      return { ...input, alt: tidyLabel(input.alt) };
    case "embed": {
      // The pasted address is replaced by the provider's canonical one: what is shown is what is stored.
      const parsed = parseEmbedInput(input.url);
      return { ...input, title: tidyLabel(input.title), url: parsed.ok ? embedPageUrl(parsed.provider, parsed.ref) ?? input.url : input.url };
    }
    case "pix": {
      const keyType = effectivePixKeyType(input);
      const key = keyType ? normalizePixKey(keyType, input.key) : null;
      const url = input.paymentUrl.trim() ? normalizeBlockUrl(input.paymentUrl) : null;
      return { ...input, label: tidyLabel(input.label), key: keyType && key !== null ? formatPixKey(keyType, key) : input.key, paymentUrl: url?.ok ? url.url : input.paymentUrl };
    }
    case "form":
      return { ...input, title: tidyLabel(input.title), buttonLabel: tidyLabel(input.buttonLabel), consentText: tidyLabel(input.consentText), fields: orderFormFields(input.fields) };
    case "text":
    case "divider":
      return input;
  }
}
