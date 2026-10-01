import { codePointLength, LINK_TITLE_MAX_LENGTH, MAX_BLOCKS, MAX_BLOCKS_BYTES, SOCIAL_ITEMS_MAX, TEXT_MAX_LENGTH, WHATSAPP_LABEL_MAX_LENGTH, WHATSAPP_MESSAGE_MAX_LENGTH } from "./limits";
import { isAllowedSocialUrl, isSocialNetwork, type SocialLink } from "./social";
import { isAllowedStoredUrl } from "./url-policy";
import { isValidWhatsAppPhone } from "./whatsapp";

/**
 * Draft block model (ADR 0008), stored in profiles.blocks. Mirror of private.validate_profile_draft:
 * the database rejects anything `validateStoredBlocks` would reject. Adding a type means changing
 * this file, the SQL validator, modules/publishing/document.ts, the renderer and both test suites.
 */
export const BLOCK_TYPES = ["link", "text", "social", "whatsapp", "divider"] as const;
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

export type DraftBlock = LinkBlock | TextBlock | SocialBlock | WhatsAppBlock | DividerBlock;

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
  }
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
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
    }
  });
}
