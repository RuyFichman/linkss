import { isAllowedSocialUrl, isAllowedStoredUrl, isSocialNetwork, isValidWhatsAppPhone, type DraftBlock, type SocialLink } from "@/modules/blocks";

/**
 * Published snapshot document (ADR 0007/0008). Built by private.build_publication_document() at
 * publish time; this module is the renderer's contract with it.
 *
 * - Version 1 (Sprint 3): page-level `socialLinks` + link blocks.
 * - Version 2 (Sprint 4): `blocks` only (link, text, social, whatsapp, divider), no `visible` flag.
 *
 * Every version that can still be restored (the last 10 publications) must keep parsing; both are
 * normalized to the version-2 view model below.
 */
export type PublishedBlock =
  | { id: string; type: "link"; title: string; url: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "social"; items: SocialLink[] }
  | { id: string; type: "whatsapp"; label: string; phone: string; message: string }
  | { id: string; type: "divider" };

export interface PublishedDocument {
  schemaVersion: 2;
  /** Version stored in the snapshot (1 for pre-Sprint-4 publications). */
  sourceSchemaVersion: 1 | 2;
  title: string;
  bio: string;
  avatarPath: string | null;
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
const V2_TYPES = new Set(["link", "text", "social", "whatsapp", "divider"]);

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
    avatarPath: typeof document.avatarPath === "string" ? document.avatarPath : null,
  };
  if (document.schemaVersion === 1) {
    // Version 1 showed social icons under the bio; a leading social block renders in the same place.
    const socialItems = parseSocialItems(document.socialLinks);
    const social: PublishedBlock[] = socialItems.length > 0 ? [{ id: LEGACY_SOCIAL_BLOCK_ID, type: "social", items: socialItems }] : [];
    return { ...common, sourceSchemaVersion: 1, blocks: [...social, ...parseBlocks(document.blocks, V1_TYPES)] };
  }
  return { ...common, sourceSchemaVersion: 2, blocks: parseBlocks(document.blocks, V2_TYPES) };
}

/** Mirror of private.published_block(): explicit fields per type, `visible` removed. */
function publishedBlock(block: DraftBlock): PublishedBlock {
  switch (block.type) {
    case "link": return { id: block.id, type: "link", title: block.title, url: block.url };
    case "text": return { id: block.id, type: "text", text: block.text };
    case "social": return { id: block.id, type: "social", items: block.items.map((item) => ({ network: item.network, url: item.url })) };
    case "whatsapp": return { id: block.id, type: "whatsapp", label: block.label, phone: block.phone, message: block.message };
    case "divider": return { id: block.id, type: "divider" };
  }
}

export interface DraftForDocument {
  title: string;
  bio: string;
  avatarPath: string | null;
  blocks: readonly DraftBlock[];
}

/**
 * Snapshot JSON exactly as private.build_publication_document() writes it: draft order, hidden
 * blocks and empty social rows dropped.
 */
export function buildDocumentJson(draft: DraftForDocument) {
  return {
    schemaVersion: 2 as const,
    title: draft.title,
    bio: draft.bio,
    avatarPath: draft.avatarPath,
    blocks: draft.blocks.filter((block) => block.visible && !(block.type === "social" && block.items.length === 0)).map(publishedBlock),
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
  return parsePublishedDocument({ ...json, title }) ?? { ...json, title, sourceSchemaVersion: 2, blocks: [] };
}
