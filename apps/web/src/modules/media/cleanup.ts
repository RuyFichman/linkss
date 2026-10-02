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

/** Upper bound for one scheduled run: the daily cron clears up to 500 assets, the rest waits a day. */
export const CLEANUP_MAX_BATCHES = 10;

/**
 * Runs batches until the backlog is empty, the bound is reached, or a batch had a failure. A failed
 * asset stays in `deleting` and would be claimed again at once, so the run stops instead of looping
 * on a storage outage; the next scheduled run retries it.
 */
export async function runMediaCleanupBatches(
  repository: MediaCleanupRepository,
  storage: StorageAdapter,
  { batchSize = CLEANUP_BATCH_SIZE, maxBatches = CLEANUP_MAX_BATCHES }: { batchSize?: number; maxBatches?: number } = {},
): Promise<CleanupReport & { batches: number }> {
  const total = { claimed: 0, removedObjects: 0, finished: 0, failed: 0, batches: 0 };
  while (total.batches < maxBatches) {
    const report = await runMediaCleanup(repository, storage, batchSize);
    total.batches += 1;
    total.claimed += report.claimed;
    total.removedObjects += report.removedObjects;
    total.finished += report.finished;
    total.failed += report.failed;
    if (report.claimed < batchSize || report.failed > 0) break;
  }
  return total;
}
