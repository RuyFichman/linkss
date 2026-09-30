/**
 * Autosave controller (ADR 0008). Framework-free and deterministic: timers are injected so the
 * status machine is unit-tested with fake time.
 *
 * Guarantees:
 * - "saved" only after the server confirmed a revision for the latest local change;
 * - saves never overlap; edits made while a save is in flight are sent afterwards, latest only;
 * - transient failures retry with backoff, then stop at "error" until the person retries;
 * - a conflict stops saving and keeps the local copy until the person decides.
 */
export type SaveFailure = "conflict" | "validation" | "forbidden" | "not_found" | "unauthenticated" | "unavailable" | "network";

export type SaveOutcome = { ok: true; revision: number } | { ok: false; error: SaveFailure };

export type AutosaveStatus = "saved" | "dirty" | "invalid" | "saving" | "retrying" | "error" | "conflict";

export interface AutosaveSnapshot {
  status: AutosaveStatus;
  /** Last revision the server confirmed (sent as the expected revision of the next save). */
  revision: number;
  /** Failure behind "error" (or the last transient one while "retrying"). */
  failure: SaveFailure | null;
}

export interface AutosaveTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AutosaveOptions<Draft> {
  revision: number;
  save: (draft: Draft, expectedRevision: number) => Promise<SaveOutcome>;
  debounceMs?: number;
  retryDelaysMs?: readonly number[];
  timers?: AutosaveTimers;
}

export const AUTOSAVE_DEBOUNCE_MS = 1000;
export const AUTOSAVE_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

const TRANSIENT: ReadonlySet<SaveFailure> = new Set(["unavailable", "network"]);

const DEFAULT_TIMERS: AutosaveTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export function createAutosave<Draft>(options: AutosaveOptions<Draft>) {
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const retryDelays = options.retryDelaysMs ?? AUTOSAVE_RETRY_DELAYS_MS;
  const timers = options.timers ?? DEFAULT_TIMERS;

  let revision = options.revision;
  /** Increments on every local change (valid or not). */
  let localVersion = 0;
  /** Local version the server has confirmed. */
  let savedVersion = 0;
  /** Latest valid draft and the local version it belongs to. */
  let latest: { draft: Draft; version: number } | null = null;
  let invalid = false;
  let inFlight = false;
  let conflict = false;
  let failure: SaveFailure | null = null;
  let attempts = 0;
  let timer: unknown = null;
  let retrying = false;
  const listeners = new Set<() => void>();
  let snapshot: AutosaveSnapshot = { status: "saved", revision, failure: null };

  function computeStatus(): AutosaveStatus {
    if (conflict) return "conflict";
    if (inFlight) return "saving";
    if (retrying) return "retrying";
    if (failure) return "error";
    if (invalid) return "invalid";
    return localVersion > savedVersion ? "dirty" : "saved";
  }

  function publish(): void {
    const next: AutosaveSnapshot = { status: computeStatus(), revision, failure: retrying || failure ? failure : null };
    if (next.status === snapshot.status && next.revision === snapshot.revision && next.failure === snapshot.failure) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function clearTimer(): void {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }

  function schedule(ms: number): void {
    clearTimer();
    timer = timers.setTimeout(() => {
      timer = null;
      retrying = false;
      void run();
    }, ms);
  }

  async function run(): Promise<void> {
    if (inFlight || conflict || !latest || latest.version <= savedVersion) {
      publish();
      return;
    }
    const sending = latest;
    inFlight = true;
    failure = null;
    publish();

    let outcome: SaveOutcome;
    try {
      outcome = await options.save(sending.draft, revision);
    } catch {
      // A rejected Server Action call: network down, server stopped, request aborted.
      outcome = { ok: false, error: "network" };
    }
    inFlight = false;

    if (outcome.ok) {
      revision = outcome.revision;
      savedVersion = sending.version;
      attempts = 0;
      failure = null;
      // Edits made while this save was in flight: send the latest right away.
      if (latest && latest.version > savedVersion && timer === null) {
        void run();
        return;
      }
      publish();
      return;
    }

    if (outcome.error === "conflict") {
      conflict = true;
      clearTimer();
      publish();
      return;
    }

    failure = outcome.error;
    if (TRANSIENT.has(outcome.error) && attempts < retryDelays.length) {
      const delay = retryDelays[attempts] ?? 0;
      attempts += 1;
      retrying = true;
      schedule(delay);
    } else {
      attempts = 0;
    }
    publish();
  }

  return {
    getSnapshot: (): AutosaveSnapshot => snapshot,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** A valid local change. Structural changes save now; typing waits for the debounce. */
    update(draft: Draft, { immediate }: { immediate: boolean }): void {
      localVersion += 1;
      latest = { draft, version: localVersion };
      invalid = false;
      if (conflict) {
        publish();
        return;
      }
      // A new edit restarts the retry budget; a pending retry is replaced by this save, and an old
      // failure no longer describes the state (it becomes "dirty" until the save runs).
      attempts = 0;
      failure = null;
      retrying = false;
      if (immediate) {
        clearTimer();
        void run();
      } else {
        schedule(debounceMs);
        publish();
      }
    },

    /** A local change that cannot be saved (invalid field). Nothing is sent until it is fixed. */
    markInvalid(): void {
      localVersion += 1;
      invalid = true;
      if (!inFlight) clearTimer();
      retrying = false;
      publish();
    },

    /** "Tentar novamente" and page-leave flushes: save the latest valid state now. */
    flush(): void {
      if (conflict) return;
      attempts = 0;
      retrying = false;
      clearTimer();
      void run();
    },

    /** "Manter as minhas alterações": overwrite on top of the current server revision. */
    keepMine(currentRevision: number): void {
      revision = currentRevision;
      conflict = false;
      failure = null;
      attempts = 0;
      clearTimer();
      if (latest) latest = { draft: latest.draft, version: localVersion };
      void run();
    },

    /** "Carregar a versão mais recente": the local copy is replaced by the server's. */
    reset(currentRevision: number): void {
      clearTimer();
      revision = currentRevision;
      localVersion += 1;
      savedVersion = localVersion;
      latest = null;
      invalid = false;
      conflict = false;
      failure = null;
      attempts = 0;
      retrying = false;
      publish();
    },

    hasUnsavedChanges(): boolean {
      return computeStatus() !== "saved";
    },

    dispose(): void {
      clearTimer();
      listeners.clear();
    },
  };
}

export type Autosave<Draft> = ReturnType<typeof createAutosave<Draft>>;
