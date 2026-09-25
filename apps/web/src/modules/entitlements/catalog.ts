import { PRODUCT, type PlanId } from "@/lib/product";
import type { Database } from "@/lib/database.types";

export type EntitlementKey = Database["public"]["Enums"]["entitlement_key"];

export const LIMIT_KEYS = ["max_profiles", "analytics_days", "team_members"] as const satisfies readonly EntitlementKey[];
export const FEATURE_KEYS = ["custom_domain", "remove_badge", "shareable_reports"] as const satisfies readonly EntitlementKey[];

export type LimitKey = (typeof LIMIT_KEYS)[number];
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface Entitlements {
  limits: Record<LimitKey, number>;
  features: Record<FeatureKey, boolean>;
}

/** Expected catalogue derived from product.ts; the database seed must match it. */
export function planEntitlementsFromProduct(planId: PlanId): Entitlements {
  const plan = PRODUCT.plans[planId];
  return {
    limits: { max_profiles: plan.includedProfiles, analytics_days: plan.analyticsDays, team_members: plan.teamMembers },
    features: { custom_domain: plan.customDomain, remove_badge: plan.removeBadge, shareable_reports: plan.shareableReports },
  };
}
