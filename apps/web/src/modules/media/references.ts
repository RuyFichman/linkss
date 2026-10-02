import { isMediaId } from "./policy";

/**
 * Media lifecycle rules (ADR 0009), mirrored by private.media_is_referenced() and
 * public.claim_media_cleanup(). An asset lives as long as the page's draft or any retained
 * publication points at it; nothing is deleted just because the draft stopped using it.
 */
interface DocumentLike {
  avatarPath?: unknown;
  blocks?: unknown;
}

/** Media ids used by a draft or by a published document (same shape for both: avatar + image blocks). */
export function mediaIdsIn(document: unknown): Set<string> {
  const ids = new Set<string>();
  if (!document || typeof document !== "object") return ids;
  const { avatarPath, blocks } = document as DocumentLike;
  if (isMediaId(avatarPath)) ids.add(avatarPath);
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (block && typeof block === "object" && (block as { type?: unknown }).type === "image") {
        const mediaId = (block as { mediaId?: unknown }).mediaId;
        if (isMediaId(mediaId)) ids.add(mediaId);
      }
    }
  }
  return ids;
}

/** Everything a page still needs: its draft plus every retained publication. */
export function referencedMediaIds(draft: unknown, retainedDocuments: readonly unknown[]): Set<string> {
  const ids = mediaIdsIn(draft);
  for (const document of retainedDocuments) for (const id of mediaIdsIn(document)) ids.add(id);
  return ids;
}

export type MediaStatus = "pending" | "ready" | "failed" | "deleting";

export interface MediaAssetState {
  id: string;
  status: MediaStatus;
  createdAt: Date;
}

/** An upload that never finished is abandoned after this long. */
export const PENDING_GRACE_MS = 60 * 60 * 1000;
/** A ready asset nothing points at is kept this long (an image uploaded but not saved yet, undo). */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export interface CleanupContext {
  referenced: ReadonlySet<string>;
  now: Date;
  /** True when the page was soft-deleted and its recovery period is over. */
  pagePurgeDue: boolean;
}

/** Whether cleanup may remove this asset's objects and row. */
export function isCleanupCandidate(asset: MediaAssetState, context: CleanupContext): boolean {
  const age = context.now.getTime() - asset.createdAt.getTime();
  if (asset.status === "deleting") return true;
  if (context.pagePurgeDue) return true;
  if (asset.status === "pending" || asset.status === "failed") return age > PENDING_GRACE_MS;
  return !context.referenced.has(asset.id) && age > ORPHAN_GRACE_MS;
}

/** Whether the asset counts against the workspace storage quota. */
export function countsTowardQuota(asset: MediaAssetState, context: Pick<CleanupContext, "referenced" | "now">): boolean {
  if (asset.status !== "pending" && asset.status !== "ready") return false;
  return context.referenced.has(asset.id) || context.now.getTime() - asset.createdAt.getTime() <= ORPHAN_GRACE_MS;
}
