import type { StorageAdapter } from "./storage/adapter";

/**
 * Orphan cleanup (ADR 0009). Idempotent: an asset is claimed (state `deleting`), its objects are
 * removed, then its row is forgotten. A failure at any point leaves the asset in `deleting`, and
 * the next run claims it again. The claim itself re-checks references under a lock, so an image a
 * draft or a retained publication uses is never removed.
 */
export interface CleanupClaim {
  mediaId: string;
  objectNames: string[];
}

/** Administrative port (service role). Never used on behalf of a signed-in user. */
export interface MediaCleanupRepository {
  claim(limit: number): Promise<CleanupClaim[]>;
  finish(mediaIds: string[]): Promise<number>;
}

export interface CleanupReport {
  claimed: number;
  removedObjects: number;
  finished: number;
  /** Assets whose objects could not be removed in this run; they stay claimed for the next one. */
  failed: number;
}

export const CLEANUP_BATCH_SIZE = 50;

export async function runMediaCleanup(repository: MediaCleanupRepository, storage: StorageAdapter, limit: number = CLEANUP_BATCH_SIZE): Promise<CleanupReport> {
  const claims = await repository.claim(limit);
  const done: string[] = [];
  let removedObjects = 0;
  for (const claim of claims) {
    try {
      await storage.remove(claim.objectNames);
      removedObjects += claim.objectNames.length;
      done.push(claim.mediaId);
    } catch {
      // Left in `deleting`; reported, and retried by the next run.
    }
  }
  const finished = done.length > 0 ? await repository.finish(done) : 0;
  return { claimed: claims.length, removedObjects, finished, failed: claims.length - done.length };
}
