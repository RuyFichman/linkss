/**
 * Execution of an account deletion request (ADR 0018, runbook ACCOUNT_DELETION.md).
 *
 * The database does the deciding and the deleting in two steps (`begin_account_erasure`,
 * `finish_account_erasure`), both restricted to a platform administrator. Between them this
 * module removes what the database cannot reach: cached public pages, hostnames attached at the
 * hosting provider and image files in the bucket. Every step is idempotent, so any outcome other
 * than `erased` is resolved by fixing its cause and running the same request again.
 */
export type ErasureRefusal =
  | "forbidden" | "not_found" | "not_processing" | "active_subscription" | "shared_workspace"
  | "media_pending" | "invalid_evidence" | "not_deployed" | "unavailable";

export type ErasureOutcome = "erased" | ErasureRefusal | "domain_failed" | "media_not_configured";

export interface ErasureBegin {
  slugs: string[];
  hostnames: string[];
  mediaPending: number;
}

export interface ErasureCounts {
  workspaces: number;
  invitations: number;
  waitlist: number;
  account: number;
}

export interface ErasurePorts {
  begin(requestId: string): Promise<{ ok: true; value: ErasureBegin } | { ok: false; reason: ErasureRefusal }>;
  finish(requestId: string, evidence: string): Promise<{ ok: true; value: ErasureCounts } | { ok: false; reason: ErasureRefusal }>;
  /** Drops the cached copies of one public page. */
  revalidate(slug: string): void;
  /** Detaches a hostname at the hosting provider; `null` when this environment attaches none. */
  detach: ((hostname: string) => Promise<void>) | null;
  /** Runs the media cleanup job; `null` when it is not configured here. Reports assets it could not remove. */
  cleanMedia(): Promise<{ failed: number } | null>;
}

export interface ErasureResult {
  outcome: ErasureOutcome;
  pages: number;
  hostnames: number;
  counts?: ErasureCounts;
}

export const EVIDENCE_MIN_LENGTH = 4;
export const EVIDENCE_MAX_LENGTH = 120;

/** Postgres error code of a refused step -> the reason shown to the operator. */
export function erasureRefusal(code: string | null | undefined, missingSchema: boolean): ErasureRefusal {
  if (missingSchema) return "not_deployed";
  switch (code) {
    case "42501": return "forbidden";
    case "P0002": return "not_found";
    case "LK122": return "not_processing";
    case "LK123": return "active_subscription";
    case "LK124": return "shared_workspace";
    case "LK125": return "media_pending";
    case "22023": return "invalid_evidence";
    default: return "unavailable";
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function parseErasureBegin(data: unknown): ErasureBegin {
  const row = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  return { slugs: strings(row.slugs), hostnames: strings(row.hostnames), mediaPending: count(row.mediaPending) };
}

export function parseErasureCounts(data: unknown): ErasureCounts {
  const row = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  return { workspaces: count(row.workspaces), invitations: count(row.invitations), waitlist: count(row.waitlist), account: count(row.account) };
}

export async function eraseAccount(ports: ErasurePorts, requestId: string, evidenceReference: string): Promise<ErasureResult> {
  const evidence = evidenceReference.trim();
  // Checked before anything goes off the air; the database checks it again in the last step.
  if (evidence.length < EVIDENCE_MIN_LENGTH || evidence.length > EVIDENCE_MAX_LENGTH) return { outcome: "invalid_evidence", pages: 0, hostnames: 0 };

  const begun = await ports.begin(requestId);
  if (!begun.ok) return { outcome: begun.reason, pages: 0, hostnames: 0 };
  const { slugs, hostnames, mediaPending } = begun.value;
  const progress = { pages: slugs.length, hostnames: hostnames.length };

  for (const slug of slugs) ports.revalidate(slug);

  if (ports.detach) {
    for (const hostname of hostnames) {
      try {
        await ports.detach(hostname);
      } catch {
        // The row that names the hostname is still there: the next run tries again.
        return { outcome: "domain_failed", ...progress };
      }
    }
  }

  if (mediaPending > 0) {
    const cleaned = await ports.cleanMedia();
    if (cleaned === null) return { outcome: "media_not_configured", ...progress };
    if (cleaned.failed > 0) return { outcome: "media_pending", ...progress };
  }

  const finished = await ports.finish(requestId, evidence);
  if (!finished.ok) return { outcome: finished.reason, ...progress };
  return { outcome: "erased", ...progress, counts: finished.value };
}
