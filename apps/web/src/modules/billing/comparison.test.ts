import { describe, expect, it } from "vitest";
import { HOME_COPY } from "@/content/pt-BR";
import { FEATURE_KEYS, planEntitlementsFromProduct } from "@/modules/entitlements";
import { PLAN_IDS } from "./catalog";
import { COMPARISON_GROUPS, planComparison, planHighlights, type ComparisonRow } from "./comparison";

const rows = (customDomains = true) => planComparison({ customDomains }).flatMap((group) => group.rows);
const row = (key: ComparisonRow["key"]) => rows().find((candidate) => candidate.key === key) as ComparisonRow;

describe("plan comparison (home)", () => {
  it("has a value for every plan in every row, and words for every group and row", () => {
    for (const group of planComparison({ customDomains: true })) {
      expect(group.rows.length).toBeGreaterThan(0);
      expect(HOME_COPY.comparison.groups[group.key]).toBeTruthy();
      for (const { key, values } of group.rows) {
        expect(HOME_COPY.comparison.rows[key]).toBeTruthy();
        expect(Object.keys(values).sort()).toEqual([...PLAN_IDS].sort());
        for (const value of Object.values(values)) if (value.kind === "limit") expect(key in HOME_COPY.comparison.limits).toBe(true);
      }
    }
    expect(rows().map((candidate) => candidate.key)).toEqual(Object.values(COMPARISON_GROUPS).flat());
  });

  it("takes every limit and every feature from the plan's entitlements", () => {
    const limitRows = { storage: "storage_mb", history: "analytics_days", pages: "max_profiles", people: "team_members" } as const;
    const featureRows = { badge: "remove_badge", domain: "custom_domain", pixels: "tracking_pixels", reports: "shareable_reports" } as const;
    expect(Object.values(featureRows).sort()).toEqual([...FEATURE_KEYS].sort());
    for (const planId of PLAN_IDS) {
      const { limits, features } = planEntitlementsFromProduct(planId);
      for (const [key, limit] of Object.entries(limitRows)) expect(row(key as keyof typeof limitRows).values[planId]).toEqual({ kind: "limit", value: limits[limit] });
      for (const [key, feature] of Object.entries(featureRows)) expect(row(key as keyof typeof featureRows).values[planId].kind).toBe(features[feature] ? "included" : "excluded");
    }
  });

  it("offers duplication only to plans with room for a second page", () => {
    expect(row("duplicate").values).toEqual({ free: { kind: "excluded" }, pro: { kind: "excluded" }, agency: { kind: "included" } });
  });

  it("leaves the custom-domain row out when custom domains are not configured", () => {
    expect(rows(false).some((candidate) => candidate.key === "domain")).toBe(false);
    expect(rows(true).some((candidate) => candidate.key === "domain")).toBe(true);
  });
});

describe("plan highlights (home cards)", () => {
  it("lists the basics on the free plan", () => {
    expect(planHighlights("free", { customDomains: true })).toEqual([
      { kind: "limit", key: "max_profiles", value: 1 },
      { kind: "product", key: "allBlocks" },
      { kind: "product", key: "leads" },
      { kind: "limit", key: "analytics_days", value: 7 },
      { kind: "limit", key: "storage_mb", value: 20 },
    ]);
  });

  it("lists only what each next plan raises or adds on top of the previous one", () => {
    expect(planHighlights("pro", { customDomains: true })).toEqual([
      { kind: "everythingIn", planId: "free" },
      { kind: "limit", key: "analytics_days", value: 90 },
      { kind: "limit", key: "storage_mb", value: 100 },
      { kind: "feature", key: "custom_domain" },
      { kind: "feature", key: "remove_badge" },
      { kind: "feature", key: "tracking_pixels" },
    ]);
    expect(planHighlights("agency", { customDomains: true })).toEqual([
      { kind: "everythingIn", planId: "pro" },
      { kind: "limit", key: "max_profiles", value: 10 },
      { kind: "limit", key: "team_members", value: 5 },
      { kind: "limit", key: "storage_mb", value: 500 },
      { kind: "feature", key: "shareable_reports" },
    ]);
  });

  it("does not promise custom domains when they are not configured", () => {
    expect(planHighlights("pro", { customDomains: false }).some((item) => item.kind === "feature" && item.key === "custom_domain")).toBe(false);
  });
});
