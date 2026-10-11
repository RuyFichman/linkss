import { createHash } from "node:crypto";

/**
 * Per-instance request limits for the public endpoints (ADR 0018).
 *
 * This is the second of two layers and it is deliberately modest. The counters live in the memory
 * of one server instance: they shed a flood from one address that lands on a warm instance, cost
 * nothing per request and need no store, but they are NOT a global limit (another instance has its
 * own counters, and a cold start resets them). The global limit is the rate-limit rule of the
 * hosting firewall, configured outside this repository (docs/runbooks/RATE_LIMITS.md), and the
 * durable limits per page and per visitor stay in the database functions.
 *
 * The address is used only as the key of a short-lived counter, as a truncated SHA-256; it is
 * never logged or stored.
 */
export interface RateLimitRule {
  /** Separates the counters of one endpoint from another's. */
  name: string;
  /** Requests allowed per address in one window. */
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;

/** One rule per endpoint. A page view sends one or two beacons; the limits leave room for shared addresses (CGNAT). */
export const RATE_LIMITS = {
  events: { name: "events", limit: 120, windowMs: MINUTE },
  vitals: { name: "vitals", limit: 60, windowMs: MINUTE },
  media: { name: "media", limit: 30, windowMs: MINUTE },
  report: { name: "report", limit: 60, windowMs: MINUTE },
  lead: { name: "lead", limit: 20, windowMs: MINUTE },
  moderation: { name: "moderation", limit: 10, windowMs: MINUTE },
} as const satisfies Record<string, RateLimitRule>;

interface Counter {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  /** Counts one request. `false` means the address is over the limit for this window. */
  allow(rule: RateLimitRule, address: string | null): boolean;
  size(): number;
}

export function createRateLimiter(options: { maxKeys?: number; now?: () => number } = {}): RateLimiter {
  const maxKeys = options.maxKeys ?? 5000;
  const now = options.now ?? Date.now;
  const counters = new Map<string, Counter>();

  function makeRoom(at: number): void {
    for (const [key, counter] of counters) if (counter.resetAt <= at) counters.delete(key);
    // Still full of live counters (many addresses at once): forget the oldest ones. Memory stays
    // bounded; the firewall is what answers a distributed flood.
    for (const key of counters.keys()) {
      if (counters.size < maxKeys) break;
      counters.delete(key);
    }
  }

  return {
    allow(rule, address) {
      // No address means no proxy in front (local runs): there is nothing to tell callers apart by.
      const trimmed = address?.trim();
      if (!trimmed) return true;
      const at = now();
      const key = `${rule.name}:${createHash("sha256").update(trimmed).digest("hex").slice(0, 16)}`;
      const counter = counters.get(key);
      if (!counter || counter.resetAt <= at) {
        if (!counter && counters.size >= maxKeys) makeRoom(at);
        counters.set(key, { count: 1, resetAt: at + rule.windowMs });
        return true;
      }
      counter.count += 1;
      return counter.count <= rule.limit;
    },
    size: () => counters.size,
  };
}

const shared = createRateLimiter();

/** The instance-wide limiter used by the routes. */
export function allowRequest(rule: RateLimitRule, address: string | null): boolean {
  return shared.allow(rule, address);
}
