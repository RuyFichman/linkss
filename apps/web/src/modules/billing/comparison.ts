import type { PlanId } from "@/lib/product";
import { FEATURE_KEYS, LIMIT_KEYS, planEntitlementsFromProduct, type Entitlements, type FeatureKey, type LimitKey } from "@/modules/entitlements";
import { PLAN_IDS } from "./catalog";

/**
 * What the public home says each plan includes: the plan cards and the comparison table (AGENTS.md
 * §10). Plan differences come from the entitlements, so the home cannot promise a limit or a feature
 * a plan does not grant. Rows that every plan has describe the product itself and must stay true of
 * the deployed product; a new entitlement needs a row here.
 */
export type ComparisonValue = { kind: "included" } | { kind: "excluded" } | { kind: "limit"; value: number };

export const COMPARISON_GROUPS = {
  page: ["address", "templates", "theme", "images", "versions", "storage", "badge", "domain"],
  blocks: ["links", "social", "whatsapp", "pix", "media", "form", "leads"],
  results: ["daily", "blockClicks", "noCookies", "history", "export", "pixels"],
  team: ["pages", "people", "consolidated", "duplicate", "reports"],
} as const;

export type ComparisonGroupKey = keyof typeof COMPARISON_GROUPS;
export type ComparisonRowKey = (typeof COMPARISON_GROUPS)[ComparisonGroupKey][number];

export interface ComparisonRow {
  key: ComparisonRowKey;
  values: Record<PlanId, ComparisonValue>;
}

export interface ComparisonGroup {
  key: ComparisonGroupKey;
  rows: ComparisonRow[];
}

const included: ComparisonValue = { kind: "included" };
const flag = (on: boolean): ComparisonValue => (on ? included : { kind: "excluded" });
const limit = (value: number): ComparisonValue => ({ kind: "limit", value });
const always = () => included;

const ROW_VALUE: Record<ComparisonRowKey, (entitlements: Entitlements) => ComparisonValue> = {
  address: always,
  templates: always,
  theme: always,
  images: always,
  versions: always,
  storage: ({ limits }) => limit(limits.storage_mb),
  badge: ({ features }) => flag(features.remove_badge),
  domain: ({ features }) => flag(features.custom_domain),
  links: always,
  social: always,
  whatsapp: always,
  pix: always,
  media: always,
  form: always,
  leads: always,
  daily: always,
  blockClicks: always,
  noCookies: always,
  history: ({ limits }) => limit(limits.analytics_days),
  export: always,
  pixels: ({ features }) => flag(features.tracking_pixels),
  pages: ({ limits }) => limit(limits.max_profiles),
  people: ({ limits }) => limit(limits.team_members),
  consolidated: always,
  // A copy is a new page, so the page limit has to leave room for it (enforced by the database).
  duplicate: ({ limits }) => flag(limits.max_profiles > 1),
  reports: ({ features }) => flag(features.shareable_reports),
};

/**
 * The comparison table, group by group. `customDomains: false` leaves the custom-domain row out,
 * like the pricing page: custom domains need their own configuration (ADR 0016).
 */
export function planComparison(options: { customDomains: boolean }): ComparisonGroup[] {
  const entitlements = Object.fromEntries(PLAN_IDS.map((planId) => [planId, planEntitlementsFromProduct(planId)])) as Record<PlanId, Entitlements>;
  return (Object.keys(COMPARISON_GROUPS) as ComparisonGroupKey[]).map((group) => ({
    key: group,
    rows: COMPARISON_GROUPS[group]
      .filter((row) => row !== "domain" || options.customDomains)
      .map((row) => ({ key: row, values: Object.fromEntries(PLAN_IDS.map((planId) => [planId, ROW_VALUE[row](entitlements[planId])])) as Record<PlanId, ComparisonValue> })),
  }));
}

const sameValue = (a: ComparisonValue, b: ComparisonValue) => a.kind === b.kind && (a.kind !== "limit" || (b.kind === "limit" && a.value === b.value));

/**
 * What changes from one plan to another, for someone who already uses the product: the rows whose
 * value is not the same on every plan, and how many rows every plan shares.
 */
export function planDifferences(options: { customDomains: boolean }): { rows: ComparisonRow[]; shared: number } {
  const rows = planComparison(options).flatMap((group) => group.rows);
  const differing = rows.filter((row) => PLAN_IDS.some((planId) => !sameValue(row.values[planId], row.values[PLAN_IDS[0]])));
  return { rows: differing, shared: rows.length - differing.length };
}

export type PlanHighlight =
  | { kind: "everythingIn"; planId: PlanId }
  | { kind: "product"; key: "allBlocks" | "leads" }
  | { kind: "limit"; key: LimitKey; value: number }
  | { kind: "feature"; key: FeatureKey };

/**
 * The short list on a plan card. The first plan lists the basics; each next plan says it includes
 * the previous one and lists only the limits it raises and the features it adds.
 */
export function planHighlights(planId: PlanId, options: { customDomains: boolean }): PlanHighlight[] {
  const { limits, features } = planEntitlementsFromProduct(planId);
  const index = PLAN_IDS.indexOf(planId);
  if (index === 0) {
    return [
      { kind: "limit", key: "max_profiles", value: limits.max_profiles },
      { kind: "product", key: "allBlocks" },
      { kind: "product", key: "leads" },
      { kind: "limit", key: "analytics_days", value: limits.analytics_days },
      { kind: "limit", key: "storage_mb", value: limits.storage_mb },
    ];
  }
  const previousId = PLAN_IDS[index - 1] as PlanId;
  const previous = planEntitlementsFromProduct(previousId);
  return [
    { kind: "everythingIn", planId: previousId },
    ...LIMIT_KEYS.filter((key) => limits[key] > previous.limits[key]).map((key): PlanHighlight => ({ kind: "limit", key, value: limits[key] })),
    ...FEATURE_KEYS.filter((key) => features[key] && !previous.features[key] && (key !== "custom_domain" || options.customDomains)).map((key): PlanHighlight => ({ kind: "feature", key })),
  ];
}
