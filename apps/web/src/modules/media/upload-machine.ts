import type { UploadedMedia, UploadErrorKind } from "./service";

/**
 * Upload controller for the editor (ADR 0009). Framework-free: the browser work (decode, crop,
 * scale down) and the network call are injected, so the status machine is unit-tested.
 *
 *   idle → preparing → uploading → processing → done
 *                 ↘ rejected (the file is not acceptable; pick another one)
 *                 ↘ failed   (network or server unavailable; "Tentar novamente" re-sends)
 *                 ↘ canceled
 *
 * A canceled or superseded attempt can never change the state afterwards.
 */
export type UploadPhase = "idle" | "preparing" | "uploading" | "processing" | "done" | "rejected" | "failed" | "canceled";

export type UploadFailure = UploadErrorKind | "network";

export interface UploadSnapshot {
  phase: UploadPhase;
  /** 0 to 1 while uploading. */
  progress: number;
  error: UploadFailure | null;
  media: UploadedMedia | null;
}

export type PrepareOutcome<Prepared> = { ok: true; prepared: Prepared } | { ok: false; error: UploadFailure };
export type SendOutcome = { ok: true; media: UploadedMedia } | { ok: false; error: UploadFailure };

export interface UploadTransport<Source, Prepared> {
  /** Browser-side checks and resizing. A rejection here never reaches the network. */
  prepare(source: Source, signal: AbortSignal): Promise<PrepareOutcome<Prepared>>;
  send(prepared: Prepared, hooks: { signal: AbortSignal; onProgress: (fraction: number) => void }): Promise<SendOutcome>;
}

/** Failures worth retrying with the same file. Everything else needs a different file or action. */
const RETRYABLE: ReadonlySet<UploadFailure> = new Set(["network", "unavailable", "rate_limited", "unauthenticated"]);

export function isRetryableUploadFailure(error: UploadFailure | null): boolean {
  return error !== null && RETRYABLE.has(error);
}

const IDLE: UploadSnapshot = { phase: "idle", progress: 0, error: null, media: null };

export function isUploadBusy(phase: UploadPhase): boolean {
  return phase === "preparing" || phase === "uploading" || phase === "processing";
}

export function createUploadController<Source, Prepared>(transport: UploadTransport<Source, Prepared>) {
  let snapshot: UploadSnapshot = IDLE;
  let attempt = 0;
  let abort: AbortController | null = null;
  let prepared: Prepared | null = null;
  const listeners = new Set<() => void>();

  function publish(next: UploadSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function send(current: number, payload: Prepared, signal: AbortSignal): Promise<void> {
    publish({ phase: "uploading", progress: 0, error: null, media: null });
    let outcome: SendOutcome;
    try {
      outcome = await transport.send(payload, {
        signal,
        onProgress: (fraction) => {
          if (current !== attempt || snapshot.phase === "processing") return;
          const progress = Math.min(1, Math.max(0, fraction));
          // All bytes sent: the server is validating and storing.
          publish(progress >= 1 ? { phase: "processing", progress: 1, error: null, media: null } : { phase: "uploading", progress, error: null, media: null });
        },
      });
    } catch {
      outcome = { ok: false, error: "network" };
    }
    if (current !== attempt) return;
    abort = null;
    if (outcome.ok) {
      prepared = null;
      publish({ phase: "done", progress: 1, error: null, media: outcome.media });
      return;
    }
    const retryable = isRetryableUploadFailure(outcome.error);
    if (!retryable) prepared = null;
    publish({ phase: retryable ? "failed" : "rejected", progress: 0, error: outcome.error, media: null });
  }

  return {
    getSnapshot: (): UploadSnapshot => snapshot,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Starts a new upload, replacing any attempt in progress. */
    async start(source: Source): Promise<void> {
      abort?.abort();
      attempt += 1;
      const current = attempt;
      const controller = new AbortController();
      abort = controller;
      prepared = null;
      publish({ phase: "preparing", progress: 0, error: null, media: null });
      let outcome: PrepareOutcome<Prepared>;
      try {
        outcome = await transport.prepare(source, controller.signal);
      } catch {
        outcome = { ok: false, error: "undecodable" };
      }
      if (current !== attempt) return;
      if (!outcome.ok) {
        abort = null;
        publish({ phase: "rejected", progress: 0, error: outcome.error, media: null });
        return;
      }
      prepared = outcome.prepared;
      await send(current, outcome.prepared, controller.signal);
    },

    /** "Tentar novamente": re-sends what was already prepared, without asking for the file again. */
    async retry(): Promise<void> {
      if (snapshot.phase !== "failed" || prepared === null) return;
      attempt += 1;
      const controller = new AbortController();
      abort = controller;
      await send(attempt, prepared, controller.signal);
    },

    cancel(): void {
      if (!isUploadBusy(snapshot.phase)) return;
      attempt += 1;
      abort?.abort();
      abort = null;
      prepared = null;
      publish({ phase: "canceled", progress: 0, error: null, media: null });
    },

    /** Back to idle (after the result was used or the message dismissed). */
    reset(): void {
      attempt += 1;
      abort?.abort();
      abort = null;
      prepared = null;
      publish(IDLE);
    },

    dispose(): void {
      attempt += 1;
      abort?.abort();
      listeners.clear();
    },
  };
}

export type UploadController<Source, Prepared> = ReturnType<typeof createUploadController<Source, Prepared>>;
