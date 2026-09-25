export const NEUTRAL_RESPONSE_MIN_MS = 900;

type Clock = () => number;
type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves (or rejects) no sooner than `minimumMs` after it starts, so fast "no email sent" paths
 * are indistinguishable by timing from paths that send an email.
 */
export async function withMinimumDuration<T>(work: () => Promise<T>, minimumMs: number, clock: Clock = () => performance.now(), sleep: Sleep = defaultSleep): Promise<T> {
  const startedAt = clock();
  try {
    return await work();
  } finally {
    const remaining = minimumMs - (clock() - startedAt);
    if (remaining > 0) await sleep(remaining);
  }
}
