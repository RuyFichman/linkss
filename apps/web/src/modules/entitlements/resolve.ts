import { FEATURE_KEYS, LIMIT_KEYS, type Entitlements, type FeatureKey, type LimitKey } from "./catalog";

export interface EntitlementRow {
  key: string;
  int_value: number | null;
  bool_value: boolean | null;
}

/**
 * Builds typed entitlements from plan_entitlements rows. Missing or malformed values resolve to the
 * most restrictive value (0 / false) so a catalogue mistake never grants access.
 */
export function resolveEntitlements(rows: readonly EntitlementRow[]): Entitlements {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const limits = Object.fromEntries(
    LIMIT_KEYS.map((key) => {
      const value = byKey.get(key)?.int_value;
      return [key, typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0];
    }),
  ) as Record<LimitKey, number>;
  const features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, byKey.get(key)?.bool_value === true])) as Record<FeatureKey, boolean>;
  return { limits, features };
}

export interface LimitUsage {
  key: LimitKey;
  used: number;
  limit: number;
  remaining: number;
  reached: boolean;
}

export function limitUsage(entitlements: Entitlements, key: LimitKey, used: number): LimitUsage {
  const limit = entitlements.limits[key];
  const remaining = Math.max(0, limit - used);
  return { key, used, limit, remaining, reached: remaining === 0 };
}

export class EntitlementError extends Error {
  constructor(readonly key: LimitKey | FeatureKey) {
    super(`Entitlement exceeded: ${key}`);
    this.name = "EntitlementError";
  }
}

/** Throws when adding `increment` would exceed the limit. The database enforces the same rule. */
export function assertEntitlement(entitlements: Entitlements, key: LimitKey, used: number, increment = 1): void {
  if (used + increment > entitlements.limits[key]) throw new EntitlementError(key);
}

export function assertFeature(entitlements: Entitlements, key: FeatureKey): void {
  if (!entitlements.features[key]) throw new EntitlementError(key);
}
