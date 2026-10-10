import { isStoredHostname } from "@/modules/domains/hostname";
import { parsePublicPixels, type PublicPixels } from "@/modules/pixels/model";
import { parsePublishedDocument, type PublishedDocument } from "./document";

export type PublicPageResult =
  | { state: "published"; slug: string; document: PublishedDocument; version: number; publishedAt: string | null; showBadge: boolean; customDomain: string | null; pixels: PublicPixels | null }
  | { state: "moved"; slug: string }
  | { state: "suspended"; slug: string }
  | { state: "unpublished"; slug: string }
  | { state: "not_found" };

export interface PublicPageRow {
  state: string;
  canonical_slug: string | null;
  document: unknown;
  version: number | null;
  published_at: string | null;
  show_badge: boolean | null;
  /** Absent in the answer of a database that does not have the Sprint 8 part 2 migration yet. */
  custom_domain?: string | null;
  pixels?: unknown;
}

export class PublicPageUnavailableError extends Error {
  constructor(readonly reason: "lookup_failed" | "invalid_document") {
    super(`Public page unavailable: ${reason}`);
    this.name = "PublicPageUnavailableError";
  }
}

/**
 * Maps a public.get_public_page() row to the renderer's states. A published row whose snapshot
 * cannot be parsed throws, so ISR keeps serving the last good page instead of caching a broken one.
 */
export function mapPublicPageRow(row: PublicPageRow | null): PublicPageResult {
  if (!row || !row.canonical_slug) return { state: "not_found" };
  const slug = row.canonical_slug;
  switch (row.state) {
    case "published": {
      const document = parsePublishedDocument(row.document);
      if (!document) throw new PublicPageUnavailableError("invalid_document");
      return {
        state: "published", slug, document, version: row.version ?? 0, publishedAt: row.published_at, showBadge: row.show_badge ?? true,
        // Decided by the database on every read (plan and proof of control): never part of the snapshot.
        customDomain: isStoredHostname(row.custom_domain) ? row.custom_domain : null,
        pixels: parsePublicPixels(row.pixels),
      };
    }
    case "moved":
    case "suspended":
    case "unpublished":
      return { state: row.state, slug };
    default:
      return { state: "not_found" };
  }
}
