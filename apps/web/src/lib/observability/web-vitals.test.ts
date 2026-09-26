import { describe, expect, it } from "vitest";
import { parseWebVitalReport } from "./web-vitals";

describe("web vitals payload", () => {
  it("accepts a known metric and rounds the value", () => {
    expect(parseWebVitalReport({ name: "LCP", value: 1234.56, rating: "good", navigationType: "navigate", route: "public_page" })).toEqual({ name: "LCP", value: 1235, rating: "good", navigationType: "navigate", route: "public_page" });
    expect(parseWebVitalReport({ name: "CLS", value: 0.04567, rating: "good", navigationType: "weird", route: "public_page" })).toMatchObject({ value: 0.046, navigationType: "other" });
  });

  it("drops unknown metrics, routes, ratings and out-of-range values", () => {
    const base = { name: "LCP", value: 100, rating: "good", navigationType: "navigate", route: "public_page" };
    for (const payload of [
      { ...base, name: "FID" },
      { ...base, route: "/ana-lima" },
      { ...base, rating: "excellent" },
      { ...base, value: -1 },
      { ...base, value: Number.POSITIVE_INFINITY },
      { ...base, value: 10_000_000 },
      { ...base, value: "100" },
      null,
      [base],
    ]) {
      expect(parseWebVitalReport(payload)).toBeNull();
    }
  });

  it("never echoes extra fields such as URLs or ids", () => {
    const report = parseWebVitalReport({ name: "TTFB", value: 80, rating: "good", navigationType: "navigate", route: "public_page", id: "v1-123", url: "https://x.example/?token=abc" });
    expect(Object.keys(report ?? {}).sort()).toEqual(["name", "navigationType", "rating", "route", "value"]);
  });
});
