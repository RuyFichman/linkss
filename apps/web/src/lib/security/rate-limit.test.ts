import { describe, expect, it } from "vitest";
import { createRateLimiter, RATE_LIMITS, type RateLimitRule } from "./rate-limit";

const rule: RateLimitRule = { name: "test", limit: 3, windowMs: 1000 };

describe("per-instance rate limiter", () => {
  it("allows up to the limit in a window and refuses the rest", () => {
    const limiter = createRateLimiter({ now: () => 0 });
    expect([1, 2, 3, 4, 5].map(() => limiter.allow(rule, "203.0.113.7"))).toEqual([true, true, true, false, false]);
  });

  it("starts again when the window ends", () => {
    let at = 0;
    const limiter = createRateLimiter({ now: () => at });
    for (let i = 0; i < 4; i += 1) limiter.allow(rule, "203.0.113.7");
    at = 999;
    expect(limiter.allow(rule, "203.0.113.7")).toBe(false);
    at = 1000;
    expect(limiter.allow(rule, "203.0.113.7")).toBe(true);
  });

  it("counts each address and each rule separately", () => {
    const limiter = createRateLimiter({ now: () => 0 });
    for (let i = 0; i < 4; i += 1) limiter.allow(rule, "203.0.113.7");
    expect(limiter.allow(rule, "203.0.113.8")).toBe(true);
    expect(limiter.allow({ ...rule, name: "other" }, "203.0.113.7")).toBe(true);
    expect(limiter.allow(rule, " 203.0.113.7 ")).toBe(false);
  });

  it("never limits a request that carries no address", () => {
    const limiter = createRateLimiter({ now: () => 0 });
    expect(Array.from({ length: 50 }, () => limiter.allow(rule, null)).every(Boolean)).toBe(true);
    expect(limiter.allow(rule, "  ")).toBe(true);
    expect(limiter.size()).toBe(0);
  });

  it("keeps memory bounded when many addresses arrive at once", () => {
    let at = 0;
    const limiter = createRateLimiter({ maxKeys: 100, now: () => at });
    for (let i = 0; i < 1000; i += 1) limiter.allow(rule, `198.51.100.${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(100);
    // Expired counters are the first to go.
    at = 5000;
    limiter.allow(rule, "192.0.2.1");
    expect(limiter.size()).toBe(1);
  });

  it("declares a positive limit and window for every endpoint", () => {
    for (const [name, endpoint] of Object.entries(RATE_LIMITS)) {
      expect(endpoint.name).toBe(name);
      expect(endpoint.limit).toBeGreaterThan(0);
      expect(endpoint.windowMs).toBeGreaterThanOrEqual(10_000);
    }
  });
});
