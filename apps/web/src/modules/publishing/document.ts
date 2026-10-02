import { isAllowedPaymentUrl, isAllowedSocialUrl, isAllowedStoredUrl, isSocialNetwork, isValidEmbedRef, isValidFormFields, isValidPixKey, isValidWhatsAppPhone, type DraftBlock, type EmbedProvider, type FormField, type PixKeyType, type SocialLink } from "@/modules/blocks";
import { IMAGE_MAX_DIMENSION } from "@/modules/blocks/limits";
import { isMediaId } from "@/modules/media/policy";
import { readTheme, type ThemeTokens } from "@/modules/themes/tokens";

/**
 * Published snapshot document (ADR 0007/0008/0010). Built by private.build_publication_document()
 * at publish time; this module is the renderer's contract with it.
 *
 * - Version 1 (Sprint 3): page-level `socialLinks` + link blocks.
 * - Version 2 (Sprint 4): `blocks` only (link, text, social, whatsapp, divider), no `visible` flag.
 * - Version 2, extended in Sprint 5 without a bump (additive): an optional `theme`, an `avatarPath`
 *   that may hold a media id, and image, embed, pix and form blocks.
 *
 * Every version that can still be restored (the last 10 publications) must keep parsing; all are
 * normalized to the view model below. A document without `theme` is the classic look.
 */
export type PublishedBlock =
  | { id: string; type: "link"; title: string; url: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "social"; items: SocialLink[] }
  | { id: string; type: "whatsapp"; label: string; phone: string; message: string }
  | { id: string; type: "divider" }
  | { id: string; type: "image"; mediaId: string; width: number; height: number; alt: string }
  | { id: string; type: "embed"; provider: EmbedProvider; ref: string; title: string }
  | { id: string; type: "pix"; label: string; keyType: PixKeyType; key: string; paymentUrl: string }
  | { id: string; type: "form"; title: string; fields: FormField[]; buttonLabel: string; consentText: string; consentRequired: boolean };

export type PublishedFormBlock = Extract<PublishedBlock, { type: "form" }>;

export interface PublishedDocument {
  schemaVersion: 2;
  /** Version stored in the snapshot (1 for pre-Sprint-4 publications). */
  sourceSchemaVersion: 1 | 2;
  title: string;
  bio: string;
  /** Media id of the avatar, or null for the initials. */
  avatarPath: string | null;
  /** `null` is the classic look (every snapshot published before Sprint 5). */
  theme: ThemeTokens | null;
  blocks: PublishedBlock[];
}

/** Stable id for the social row of a version-1 document (it had no block id). */
export const LEGACY_SOCIAL_BLOCK_ID = "legacy-social";

function parseSocialItems(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item): SocialLink[] => {
    if (!item || typeof item !== "object") return [];
    const link = item as Record<string, unknown>;
    if (!isSocialNetwork(link.network) || seen.has(link.network) || typeof link.url !== "string" || !isAllowedSocialUrl(link.network, link.url)) return [];
    seen.add(link.network);
    return [{ network: link.network, url: link.url }];
  });
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= IMAGE_MAX_DIMENSION;
}

/**
 * One block, re-checked on read (defense in depth: the database already validated it). Anything
 * that fails is dropped rather than rendered.
 */
function parseBlock(value: unknown): PublishedBlock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const block = value as Record<string, unknown>;
  if (!nonBlank(block.id)) return null;
  const id = block.id;
  switch (block.type) {
    case "link":
      return nonBlank(block.title) && isAllowedStoredUrl(block.url) ? { id, type: "link", title: block.title, url: block.url } : null;
    case "text":
      return nonBlank(block.text) ? { id, type: "text", text: block.text } : null;
    case "social": {
      const items = parseSocialItems(block.items);
      return items.length > 0 ? { id, type: "social", items } : null;
    }
    case "whatsapp":
      return nonBlank(block.label) && isValidWhatsAppPhone(block.phone)
        ? { id, type: "whatsapp", label: block.label, phone: block.phone, message: typeof block.message === "string" ? block.message : "" }
        : null;
    case "divider":
      return { id, type: "divider" };
    case "image":
      return isMediaId(block.mediaId) && isDimension(block.width) && isDimension(block.height)
        ? { id, type: "image", mediaId: block.mediaId, width: block.width, height: block.height, alt: typeof block.alt === "string" ? block.alt : "" }
        : null;
    case "embed":
      return isValidEmbedRef(block.provider, block.ref) && nonBlank(block.title)
        ? { id, type: "embed", provider: block.provider as EmbedProvider, ref: block.ref, title: block.title }
        : null;
    case "pix":
      return nonBlank(block.label) && isValidPixKey(block.keyType, block.key)
        ? { id, type: "pix", label: block.label, keyType: block.keyType as PixKeyType, key: block.key, paymentUrl: isAllowedPaymentUrl(block.paymentUrl) ? block.paymentUrl : "" }
        : null;
    case "form":
      return nonBlank(block.title) && isValidFormFields(block.fields) && nonBlank(block.buttonLabel) && nonBlank(block.consentText) && typeof block.consentRequired === "boolean"
        ? { id, type: "form", title: block.title, fields: [...block.fields], buttonLabel: block.buttonLabel, consentText: block.consentText, consentRequired: block.consentRequired }
        : null;
    default:
      return null;
  }
}

function parseBlocks(value: unknown, allowed: ReadonlySet<string>): PublishedBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PublishedBlock[] => {
    const type = item && typeof item === "object" ? (item as Record<string, unknown>).type : undefined;
    if (typeof type !== "string" || !allowed.has(type)) return [];
    const block = parseBlock(item);
    return block ? [block] : [];
  });
}

const V1_TYPES = new Set(["link"]);
const V2_TYPES = new Set(["link", "text", "social", "whatsapp", "divider", "image", "embed", "pix", "form"]);

/**
 * Validates a snapshot read from the database. Returns null for an unknown schema version or a
 * missing title (the renderer then fails instead of showing a broken page).
 */
export function parsePublishedDocument(value: unknown): PublishedDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const document = value as Record<string, unknown>;
  if ((document.schemaVersion !== 1 && document.schemaVersion !== 2) || !nonBlank(document.title)) return null;
  const common = {
    schemaVersion: 2 as const,
    title: document.title,
    bio: typeof document.bio === "string" ? document.bio : "",
    // Anything that is not a media id (there was no upload before Sprint 5) shows the initials.
    avatarPath: isMediaId(document.avatarPath) ? document.avatarPath : null,
  };
  if (document.schemaVersion === 1) {
    // Version 1 showed social icons under the bio; a leading social block renders in the same place.
    const socialItems = parseSocialItems(document.socialLinks);
    const social: PublishedBlock[] = socialItems.length > 0 ? [{ id: LEGACY_SOCIAL_BLOCK_ID, type: "social", items: socialItems }] : [];
    return { ...common, sourceSchemaVersion: 1, theme: null, blocks: [...social, ...parseBlocks(document.blocks, V1_TYPES)] };
  }
  // An invalid theme falls back to the classic look rather than failing the page.
  return { ...common, sourceSchemaVersion: 2, theme: readTheme(document.theme), blocks: parseBlocks(document.blocks, V2_TYPES) };
}

/** Mirror of private.published_block(): explicit fields per type, `visible` removed. */
function publishedBlock(block: DraftBlock): PublishedBlock {
  switch (block.type) {
    case "link": return { id: block.id, type: "link", title: block.title, url: block.url };
    case "text": return { id: block.id, type: "text", text: block.text };
    case "social": return { id: block.id, type: "social", items: block.items.map((item) => ({ network: item.network, url: item.url })) };
    case "whatsapp": return { id: block.id, type: "whatsapp", label: block.label, phone: block.phone, message: block.message };
    case "divider": return { id: block.id, type: "divider" };
    // A decorative image is published with an empty description.
    case "image": return { id: block.id, type: "image", mediaId: block.mediaId, width: block.width, height: block.height, alt: block.decorative ? "" : block.alt };
    case "embed": return { id: block.id, type: "embed", provider: block.provider, ref: block.ref, title: block.title };
    case "pix": return { id: block.id, type: "pix", label: block.label, keyType: block.keyType, key: block.key, paymentUrl: block.paymentUrl };
    case "form": return { id: block.id, type: "form", title: block.title, fields: [...block.fields], buttonLabel: block.buttonLabel, consentText: block.consentText, consentRequired: block.consentRequired };
  }
}

export interface DraftForDocument {
  title: string;
  bio: string;
  avatarPath: string | null;
  theme: ThemeTokens | null;
  blocks: readonly DraftBlock[];
}

/**
 * Snapshot JSON exactly as private.build_publication_document() writes it: draft order, hidden
 * blocks and empty social rows dropped, `theme` present only when the page has one.
 */
export function buildDocumentJson(draft: DraftForDocument) {
  return {
    schemaVersion: 2 as const,
    title: draft.title,
    bio: draft.bio,
    avatarPath: draft.avatarPath,
    blocks: draft.blocks.filter((block) => block.visible && !(block.type === "social" && block.items.length === 0)).map(publishedBlock),
    ...(draft.theme ? { theme: draft.theme } : {}),
  };
}

/**
 * What visitors will see once the draft is published: the database's document read back through
 * the renderer's own parser. Used by the editor preview and the draft preview page, so the preview
 * is exactly the published page (AC1). An empty title falls back to `fallbackTitle`.
 */
export function documentFromDraft(draft: DraftForDocument, fallbackTitle = "?"): PublishedDocument {
  const json = buildDocumentJson(draft);
  const title = draft.title.trim() ? draft.title : fallbackTitle;
  // Never null: the version is 2 and the title is not blank.
  return parsePublishedDocument({ ...json, title }) ?? { schemaVersion: 2, sourceSchemaVersion: 2, title, bio: draft.bio, avatarPath: null, theme: null, blocks: [] };
}

/** The form block a visitor is submitting to, as published. Used to validate submissions. */
export function findPublishedForm(document: PublishedDocument, blockId: string): PublishedFormBlock | null {
  const block = document.blocks.find((item) => item.id === blockId);
  return block?.type === "form" ? block : null;
}
