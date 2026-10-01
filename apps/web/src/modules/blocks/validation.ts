import { BLOCKS_COPY } from "@/content/pt-BR";
import { codePointLength, LINK_TITLE_MAX_LENGTH, TEXT_MAX_LENGTH, WHATSAPP_LABEL_MAX_LENGTH, WHATSAPP_MESSAGE_MAX_LENGTH } from "./limits";
import { hasForbiddenLabelCharacters, hasForbiddenMultilineCharacters, normalizeLabel, normalizeMultiline, type BlockType, type DraftBlock } from "./model";
import { normalizeSocialInput, SOCIAL_NETWORK_IDS, SOCIAL_NETWORKS, type SocialLink, type SocialNetwork } from "./social";
import { normalizeBlockUrl, type UrlRejection } from "./url-policy";
import { formatWhatsAppPhone, normalizeWhatsAppPhone } from "./whatsapp";

/** What the person types in each block form (raw strings, before normalization). */
export type BlockInput =
  | { type: "link"; title: string; url: string }
  | { type: "text"; text: string }
  | { type: "social"; items: Partial<Record<SocialNetwork, string>> }
  | { type: "whatsapp"; label: string; phone: string; message: string }
  | { type: "divider" };

export type BlockField = "title" | "url" | "text" | "label" | "phone" | "message" | SocialNetwork;
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
  }
}

/** Form values for an existing block (the stored forms, WhatsApp number formatted for reading). */
export function blockToInput(block: DraftBlock): BlockInput {
  switch (block.type) {
    case "link": return { type: "link", title: block.title, url: block.url };
    case "text": return { type: "text", text: block.text };
    case "social": return { type: "social", items: Object.fromEntries(block.items.map((item) => [item.network, item.url])) };
    case "whatsapp": return { type: "whatsapp", label: block.label, phone: /^\d+$/.test(block.phone) ? formatWhatsAppPhone(block.phone) : block.phone, message: block.message };
    case "divider": return { type: "divider" };
  }
}

function labelError(raw: string, max: number): string | undefined {
  if (hasForbiddenLabelCharacters(raw)) return BLOCKS_COPY.errors.controlCharacters;
  const value = normalizeLabel(raw);
  return codePointLength(value) < 1 || codePointLength(value) > max ? BLOCKS_COPY.errors.titleLength : undefined;
}

function multilineError(raw: string, min: number, max: number, lengthMessage: string): string | undefined {
  const value = normalizeMultiline(raw);
  if (hasForbiddenMultilineCharacters(value)) return BLOCKS_COPY.errors.controlCharacters;
  return codePointLength(value) < min || codePointLength(value) > max ? lengthMessage : undefined;
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
  }
}

/**
 * The input shown back after a field loses focus: each valid field in its normalized form
 * ("https://" added, number formatted); invalid fields stay as typed so the person can fix them.
 */
export function normalizedInput(input: BlockInput): BlockInput {
  switch (input.type) {
    case "link": {
      const url = normalizeBlockUrl(input.url);
      return { ...input, title: input.title.trim() ? normalizeLabel(input.title) : input.title, url: url.ok ? url.url : input.url };
    }
    case "whatsapp": {
      const phone = normalizeWhatsAppPhone(input.phone);
      return { ...input, label: input.label.trim() ? normalizeLabel(input.label) : input.label, phone: phone.ok ? formatWhatsAppPhone(phone.phone) : input.phone };
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
    case "text":
    case "divider":
      return input;
  }
}
