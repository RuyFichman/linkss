import { isEmbedProvider, isValidEmbedRef, type EmbedProvider } from "./embed";
import { isFormField, isValidFormFields, type FormField } from "./form";
import { codePointLength, EMBED_TITLE_MAX_LENGTH, FORM_BUTTON_MAX_LENGTH, FORM_CONSENT_MAX_LENGTH, FORM_TITLE_MAX_LENGTH, IMAGE_ALT_MAX_LENGTH, IMAGE_MAX_DIMENSION, LINK_TITLE_MAX_LENGTH, MAX_BLOCKS, MAX_BLOCKS_BYTES, PIX_LABEL_MAX_LENGTH, SOCIAL_ITEMS_MAX, TEXT_MAX_LENGTH, WHATSAPP_LABEL_MAX_LENGTH, WHATSAPP_MESSAGE_MAX_LENGTH } from "./limits";
import { isPixKeyType, isValidPixKey, type PixKeyType } from "./pix";
import { isAllowedSocialUrl, isSocialNetwork, type SocialLink } from "./social";
import { isAllowedStoredUrl } from "./url-policy";
import { isValidWhatsAppPhone } from "./whatsapp";

/**
 * Draft block model (ADR 0008, extended by ADR 0010), stored in profiles.blocks. Mirror of
 * private.validate_profile_draft: the database rejects anything `validateStoredBlocks` would
 * reject, and additionally checks that an image block points to a ready asset of the same page.
 * Adding a type means changing this file, the SQL validator, modules/publishing/document.ts, the
 * renderer and both test suites.
 */
export const BLOCK_TYPES = ["link", "text", "social", "whatsapp", "divider", "image", "embed", "pix", "form"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

interface BlockBase {
  id: string;
  visible: boolean;
}

export interface LinkBlock extends BlockBase { type: "link"; title: string; url: string }
export interface TextBlock extends BlockBase { type: "text"; text: string }
export interface SocialBlock extends BlockBase { type: "social"; items: SocialLink[] }
export interface WhatsAppBlock extends BlockBase { type: "whatsapp"; label: string; phone: string; message: string }
export interface DividerBlock extends BlockBase { type: "divider" }
/** `mediaId` is a ready image asset of the same page (checked by the database); the dimensions are its master's. */
export interface ImageBlock extends BlockBase { type: "image"; mediaId: string; width: number; height: number; alt: string; decorative: boolean }
export interface EmbedBlock extends BlockBase { type: "embed"; provider: EmbedProvider; ref: string; title: string }
/** `paymentUrl` is "" or an https destination; the payment itself always happens elsewhere. */
export interface PixBlock extends BlockBase { type: "pix"; label: string; keyType: PixKeyType; key: string; paymentUrl: string }
export interface FormBlock extends BlockBase { type: "form"; title: string; fields: FormField[]; buttonLabel: string; consentText: string; consentRequired: boolean }

export type DraftBlock = LinkBlock | TextBlock | SocialBlock | WhatsAppBlock | DividerBlock | ImageBlock | EmbedBlock | PixBlock | FormBlock;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// C0 controls except line feed, DEL and C1 controls. The SQL side rejects [[:cntrl:]] except line feed.
const MULTILINE_FORBIDDEN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
const SINGLE_LINE_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f]/;

/** Exact key set per type; unknown keys are refused on both sides. */
const KEYS: Record<BlockType, readonly string[]> = {
  link: ["id", "title", "type", "url", "visible"],
  text: ["id", "text", "type", "visible"],
  social: ["id", "items", "type", "visible"],
  whatsapp: ["id", "label", "message", "phone", "type", "visible"],
  divider: ["id", "type", "visible"],
  image: ["alt", "decorative", "height", "id", "mediaId", "type", "visible", "width"],
  embed: ["id", "provider", "ref", "title", "type", "visible"],
  pix: ["id", "key", "keyType", "label", "paymentUrl", "type", "visible"],
  form: ["buttonLabel", "consentRequired", "consentText", "fields", "id", "title", "type", "visible"],
};

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && (BLOCK_TYPES as readonly string[]).includes(value);
}

export function isBlockId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Single-line label: trimmed, inner whitespace collapsed. */
export function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Multi-line text: CRLF/CR become LF, trimmed at both ends. */
export function normalizeMultiline(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function isValidLabel(value: unknown, max: number): value is string {
  return typeof value === "string" && value === normalizeLabel(value) && !SINGLE_LINE_FORBIDDEN.test(value) && codePointLength(value) >= 1 && codePointLength(value) <= max;
}

export function isValidMultiline(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value === normalizeMultiline(value) && !MULTILINE_FORBIDDEN.test(value) && codePointLength(value) >= min && codePointLength(value) <= max;
}

export function hasForbiddenMultilineCharacters(value: string): boolean {
  return MULTILINE_FORBIDDEN.test(value);
}

export function hasForbiddenLabelCharacters(value: string): boolean {
  return SINGLE_LINE_FORBIDDEN.test(value.replace(/[\t\n\r]/g, " "));
}

function hasExactKeys(value: Record<string, unknown>, type: BlockType): boolean {
  const keys = Object.keys(value).sort();
  const expected = KEYS[type];
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= IMAGE_MAX_DIMENSION;
}

/** Empty, or an https web destination (a payment page is never plain http, mail or phone). */
export function isAllowedPaymentUrl(value: unknown): value is string {
  return value === "" || (isAllowedStoredUrl(value) && value.startsWith("https://"));
}

function isValidSocialItems(value: unknown): value is SocialLink[] {
  if (!Array.isArray(value) || value.length > SOCIAL_ITEMS_MAX) return false;
  const networks = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== "network" || keys[1] !== "url") return false;
    if (!isSocialNetwork(record.network) || typeof record.url !== "string" || !isAllowedSocialUrl(record.network, record.url)) return false;
    if (networks.has(record.network)) return false;
    networks.add(record.network);
  }
  return true;
}

/** Strict check of one stored block (exact keys, normalized values). */
export function isValidStoredBlock(value: unknown): value is DraftBlock {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  if (!isBlockType(block.type) || !hasExactKeys(block, block.type) || !isBlockId(block.id) || typeof block.visible !== "boolean") return false;
  switch (block.type) {
    case "link": return isValidLabel(block.title, LINK_TITLE_MAX_LENGTH) && isAllowedStoredUrl(block.url);
    case "text": return isValidMultiline(block.text, 1, TEXT_MAX_LENGTH);
    case "social": return isValidSocialItems(block.items);
    case "whatsapp": return isValidLabel(block.label, WHATSAPP_LABEL_MAX_LENGTH) && isValidWhatsAppPhone(block.phone) && isValidMultiline(block.message, 0, WHATSAPP_MESSAGE_MAX_LENGTH);
    case "divider": return true;
    case "image":
      return isBlockId(block.mediaId) && isDimension(block.width) && isDimension(block.height) && typeof block.decorative === "boolean"
        && (block.decorative ? block.alt === "" : isValidLabel(block.alt, IMAGE_ALT_MAX_LENGTH));
    case "embed": return isValidEmbedRef(block.provider, block.ref) && isValidLabel(block.title, EMBED_TITLE_MAX_LENGTH);
    case "pix": return isValidLabel(block.label, PIX_LABEL_MAX_LENGTH) && isValidPixKey(block.keyType, block.key) && isAllowedPaymentUrl(block.paymentUrl);
    case "form":
      return isValidLabel(block.title, FORM_TITLE_MAX_LENGTH) && isValidFormFields(block.fields) && isValidLabel(block.buttonLabel, FORM_BUTTON_MAX_LENGTH)
        && isValidLabel(block.consentText, FORM_CONSENT_MAX_LENGTH) && typeof block.consentRequired === "boolean";
  }
}

/**
 * Text form Postgres gives a jsonb value (`blocks::text`): object keys sorted by length then bytes,
 * ", " and ": " separators. Used so the byte cap means the same thing on both sides.
 */
export function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((key) => `${JSON.stringify(key)}: ${jsonbText((value as Record<string, unknown>)[key])}`).join(", ")}}`;
  }
  return JSON.stringify(value);
}

export function blocksByteSize(blocks: readonly DraftBlock[]): number {
  return new TextEncoder().encode(jsonbText(blocks)).length;
}

export type StoredBlocksCheck = { ok: true; blocks: DraftBlock[] } | { ok: false; reason: "shape" | "invalid_block" | "duplicate_id" | "too_many" | "too_large"; index?: number };

/**
 * Validates an untrusted `blocks` payload (Server Action input) exactly like the database. Values
 * must already be normalized; nothing is repaired here.
 */
export function validateStoredBlocks(value: unknown): StoredBlocksCheck {
  if (!Array.isArray(value)) return { ok: false, reason: "shape" };
  if (value.length > MAX_BLOCKS) return { ok: false, reason: "too_many" };
  const ids = new Set<string>();
  for (const [index, block] of value.entries()) {
    if (!isValidStoredBlock(block)) return { ok: false, reason: "invalid_block", index };
    if (ids.has(block.id)) return { ok: false, reason: "duplicate_id", index };
    ids.add(block.id);
  }
  const blocks = value.map(cloneBlock);
  // Byte size is measured on the canonical serialization the database stores (jsonb text).
  if (blocksByteSize(blocks) > MAX_BLOCKS_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, blocks };
}

/** Copy with keys in a fixed order and no extra properties. */
export function cloneBlock(block: DraftBlock): DraftBlock {
  switch (block.type) {
    case "link": return { id: block.id, type: "link", visible: block.visible, title: block.title, url: block.url };
    case "text": return { id: block.id, type: "text", visible: block.visible, text: block.text };
    case "social": return { id: block.id, type: "social", visible: block.visible, items: block.items.map((item) => ({ network: item.network, url: item.url })) };
    case "whatsapp": return { id: block.id, type: "whatsapp", visible: block.visible, label: block.label, phone: block.phone, message: block.message };
    case "divider": return { id: block.id, type: "divider", visible: block.visible };
    case "image": return { id: block.id, type: "image", visible: block.visible, mediaId: block.mediaId, width: block.width, height: block.height, alt: block.alt, decorative: block.decorative };
    case "embed": return { id: block.id, type: "embed", visible: block.visible, provider: block.provider, ref: block.ref, title: block.title };
    case "pix": return { id: block.id, type: "pix", visible: block.visible, label: block.label, keyType: block.keyType, key: block.key, paymentUrl: block.paymentUrl };
    case "form": return { id: block.id, type: "form", visible: block.visible, title: block.title, fields: [...block.fields], buttonLabel: block.buttonLabel, consentText: block.consentText, consentRequired: block.consentRequired };
  }
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Tolerant reader of stored drafts for the editor: keeps every block of a known type with a valid
 * id, even if its content no longer passes the current policy (the editor flags it instead of
 * silently dropping it on the next save). Unknown types and malformed entries are dropped.
 */
export function readDraftBlocks(value: unknown): DraftBlock[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item): DraftBlock[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (!isBlockType(record.type) || !isBlockId(record.id) || seen.has(record.id)) return [];
    seen.add(record.id);
    const base = { id: record.id, visible: record.visible !== false };
    switch (record.type) {
      case "link": return [{ ...base, type: "link", title: stringField(record, "title"), url: stringField(record, "url") }];
      case "text": return [{ ...base, type: "text", text: stringField(record, "text") }];
      case "social": {
        const items = Array.isArray(record.items) ? record.items : [];
        return [{
          ...base, type: "social",
          items: items.flatMap((entry): SocialLink[] => {
            if (!entry || typeof entry !== "object") return [];
            const link = entry as Record<string, unknown>;
            return isSocialNetwork(link.network) && typeof link.url === "string" ? [{ network: link.network, url: link.url }] : [];
          }),
        }];
      }
      case "whatsapp": return [{ ...base, type: "whatsapp", label: stringField(record, "label"), phone: stringField(record, "phone"), message: stringField(record, "message") }];
      case "divider": return [{ ...base, type: "divider" }];
      case "image": return [{ ...base, type: "image", mediaId: stringField(record, "mediaId"), width: numberField(record, "width"), height: numberField(record, "height"), alt: stringField(record, "alt"), decorative: record.decorative === true }];
      case "embed":
        // A provider outside the allowlist cannot be shown or repaired in the form: dropped.
        return isEmbedProvider(record.provider) ? [{ ...base, type: "embed", provider: record.provider, ref: stringField(record, "ref"), title: stringField(record, "title") }] : [];
      case "pix": return [{ ...base, type: "pix", label: stringField(record, "label"), keyType: isPixKeyType(record.keyType) ? record.keyType : "random", key: stringField(record, "key"), paymentUrl: stringField(record, "paymentUrl") }];
      case "form":
        return [{ ...base, type: "form", title: stringField(record, "title"), fields: Array.isArray(record.fields) ? record.fields.filter(isFormField) : [], buttonLabel: stringField(record, "buttonLabel"), consentText: stringField(record, "consentText"), consentRequired: record.consentRequired !== false }];
    }
  });
}
