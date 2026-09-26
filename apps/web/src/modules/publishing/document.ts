import { normalizeUrl } from "@/modules/editor/model/urls";
import { parseSocialLinks, type DraftLinkBlock } from "@/modules/profiles/draft-content";
import type { SocialLink } from "./social";

/**
 * Published snapshot document, schema version 1. Built by private.build_publication_document()
 * at publish time; this module is the renderer's contract with it.
 */
export interface PublishedLinkBlock {
  id: string;
  type: "link";
  title: string;
  url: string;
}

export interface PublishedDocument {
  schemaVersion: 1;
  title: string;
  bio: string;
  avatarPath: string | null;
  socialLinks: SocialLink[];
  blocks: PublishedLinkBlock[];
}

function parseBlocks(value: unknown): PublishedLinkBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PublishedLinkBlock[] => {
    if (!item || typeof item !== "object") return [];
    const block = item as Record<string, unknown>;
    if (block.type !== "link" || typeof block.id !== "string" || typeof block.title !== "string" || typeof block.url !== "string") return [];
    // Defense in depth: the database already refuses unsafe schemes, the renderer checks again.
    const url = normalizeUrl(block.url);
    if (!url.ok || !block.title.trim()) return [];
    return [{ id: block.id, type: "link", title: block.title, url: url.url }];
  });
}

/**
 * Validates a snapshot read from the database. Returns null for an unknown schema version or a
 * missing title (the renderer then fails instead of showing a broken page); individual invalid
 * links are dropped.
 */
export function parsePublishedDocument(value: unknown): PublishedDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== 1 || typeof document.title !== "string" || !document.title.trim()) return null;
  return {
    schemaVersion: 1,
    title: document.title,
    bio: typeof document.bio === "string" ? document.bio : "",
    avatarPath: typeof document.avatarPath === "string" ? document.avatarPath : null,
    socialLinks: parseSocialLinks(document.socialLinks),
    blocks: parseBlocks(document.blocks),
  };
}

/**
 * Same document the database builds at publish time (private.build_publication_document), used by
 * the draft preview so owners see exactly what publishing will put on the air.
 */
export function documentFromDraft(draft: { title: string; bio: string; avatarPath: string | null; socialLinks: SocialLink[]; blocks: DraftLinkBlock[] }): PublishedDocument {
  return parsePublishedDocument({
    schemaVersion: 1,
    title: draft.title,
    bio: draft.bio,
    avatarPath: draft.avatarPath,
    socialLinks: draft.socialLinks,
    blocks: draft.blocks.filter((block) => block.visible).map(({ id, type, title, url }) => ({ id, type, title, url })),
  }) as PublishedDocument;
}
