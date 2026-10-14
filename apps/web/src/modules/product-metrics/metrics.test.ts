import { describe, expect, it } from "vitest";
import { ACTIVATION_GATE_PERCENT, FUNNEL_STEPS, activation, funnelRows, parseProductMetrics, rate, type FunnelCounts } from "./metrics";

const counts = (overrides: Partial<FunnelCounts> = {}): FunnelCounts => ({
  signedUp: 10, confirmed: 9, createdPage: 8, published: 6, published24h: 5, visited: 5, valueAction: 3, paid: 1, medianMinutesToPublish: 7.5, ...overrides,
});

const answer = {
  generatedAt: "2026-10-13T12:00:00.000Z", timezone: "America/Sao_Paulo", weeks: 2,
  totals: counts(),
  cohorts: [{ weekStart: "2026-10-12", ...counts({ signedUp: 4, published: 3 }) }, { weekStart: "2026-10-05", ...counts({ signedUp: 6, published: 3 }) }],
  cancellationReasons: [{ reason: "too_expensive", count: 2 }, { reason: "other", count: 1 }],
  cancellationComments: [{ reason: "other", comment: "faltou agenda", planId: "pro", createdAt: "2026-10-12T10:00:00.000Z" }],
};

describe("product metrics", () => {
  it("reads the database answer", () => {
    const metrics = parseProductMetrics(answer);
    expect(metrics?.totals).toEqual(counts());
    expect(metrics?.cohorts.map((cohort) => `${cohort.weekStart}:${cohort.signedUp}:${cohort.published}`)).toEqual(["2026-10-12:4:3", "2026-10-05:6:3"]);
    expect(metrics?.cancellationReasons).toEqual([{ reason: "too_expensive", count: 2 }, { reason: "other", count: 1 }]);
    expect(metrics?.cancellationComments).toEqual([{ reason: "other", comment: "faltou agenda", planId: "pro", createdAt: "2026-10-12T10:00:00.000Z" }]);
  });

  it("treats an unexpected answer as unavailable instead of as zeros", () => {
    for (const bad of [null, undefined, "x", [], {}, { generatedAt: "not a date", totals: {}, cohorts: [] }, { generatedAt: answer.generatedAt, cohorts: [] }, { generatedAt: answer.generatedAt, totals: {}, cohorts: "x" }]) {
      expect(parseProductMetrics(bad)).toBeNull();
    }
  });

  it("drops what it does not know and never invents a number", () => {
    const metrics = parseProductMetrics({
      ...answer,
      totals: { signedUp: -3, confirmed: "9", published: 2.5, medianMinutesToPublish: "fast" },
      cohorts: [{ weekStart: "12/10/2026", signedUp: 4 }, null, { weekStart: "2026-10-05", signedUp: 6 }],
      cancellationReasons: [{ reason: "made_up", count: 9 }, { reason: "other", count: 0 }, { reason: "temporary", count: 1 }],
      cancellationComments: [{ reason: "other", comment: "", planId: "pro", createdAt: "x" }, { reason: "other", comment: "ok", planId: "gold", createdAt: "2026-10-12T10:00:00.000Z" }],
    });
    expect(metrics?.totals).toEqual(counts({ signedUp: 0, confirmed: 0, createdPage: 0, published: 0, published24h: 0, visited: 0, valueAction: 0, paid: 0, medianMinutesToPublish: null }));
    expect(metrics?.cohorts.map((cohort) => cohort.weekStart)).toEqual(["2026-10-05"]);
    expect(metrics?.cancellationReasons).toEqual([{ reason: "temporary", count: 1 }]);
    expect(metrics?.cancellationComments).toEqual([{ reason: "other", comment: "ok", planId: null, createdAt: "2026-10-12T10:00:00.000Z" }]);
  });

  it("has no rate without a denominator", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(3, 0)).toBeNull();
    expect(rate(0, 5)).toBe(0);
    expect(rate(1, 3)).toBe(33);
    expect(rate(2, 3)).toBe(67);
  });

  it("gives each step its share of the accounts created and of the step before", () => {
    const rows = funnelRows(counts());
    expect(rows.map((row) => row.step)).toEqual([...FUNNEL_STEPS]);
    expect(rows[0]).toEqual({ step: "signedUp", count: 10, ofSignedUp: 100, ofPrevious: null });
    expect(rows.find((row) => row.step === "published")).toEqual({ step: "published", count: 6, ofSignedUp: 60, ofPrevious: 75 });
    expect(rows.find((row) => row.step === "paid")).toEqual({ step: "paid", count: 1, ofSignedUp: 10, ofPrevious: 33 });
    expect(funnelRows(counts({ signedUp: 0, confirmed: 0, createdPage: 0, published: 0, visited: 0, valueAction: 0, paid: 0 })).every((row) => row.ofSignedUp === null)).toBe(true);
  });

  it("measures activation as accounts that published, against the 60% gate", () => {
    expect(ACTIVATION_GATE_PERCENT).toBe(60);
    expect(activation(counts())).toEqual({ percent: 60, meetsGate: true, within24hPercent: 50 });
    expect(activation(counts({ published: 5 }))).toEqual({ percent: 50, meetsGate: false, within24hPercent: 50 });
    // Nobody signed up: the gate is neither met nor missed.
    expect(activation(counts({ signedUp: 0, published: 0, published24h: 0 }))).toEqual({ percent: null, meetsGate: null, within24hPercent: null });
  });
});
