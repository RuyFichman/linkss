import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRODUCT, type PlanId } from "@/lib/product";
import { planEntitlementsFromProduct } from "./catalog";
import { EntitlementError, assertEntitlement, assertFeature, limitUsage, resolveEntitlements, type EntitlementRow } from "./resolve";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));

function seededRows(): Map<string, EntitlementRow[]> {
  const sql = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).map((file) => readFileSync(MIGRATIONS_DIR + file, "utf8")).join("\n");
  const rows = new Map<string, EntitlementRow[]>();
  for (const match of sql.matchAll(/\('([a-z_]+)', '([a-z_]+)', (null|\d+), (null|true|false)\)/g)) {
    const [, planId, key, intValue, boolValue] = match;
    if (!planId || !key || !intValue || !boolValue) continue;
    const list = rows.get(planId) ?? [];
    list.push({ key, int_value: intValue === "null" ? null : Number(intValue), bool_value: boolValue === "null" ? null : boolValue === "true" });
    rows.set(planId, list);
  }
  return rows;
}

describe("entitlement catalogue", () => {
  it("database seed matches product.ts for every plan (drift guard)", () => {
    const rows = seededRows();
    for (const planId of Object.keys(PRODUCT.plans) as PlanId[]) {
      expect(rows.get(planId), `plan ${planId} is seeded`).toBeDefined();
      expect(resolveEntitlements(rows.get(planId) ?? [])).toEqual(planEntitlementsFromProduct(planId));
    }
  });

  it("keeps Free at one page and Agency multi-page", () => {
    expect(planEntitlementsFromProduct("free").limits.max_profiles).toBe(1);
    expect(planEntitlementsFromProduct("agency").limits.max_profiles).toBeGreaterThan(1);
  });
});

describe("entitlement resolution", () => {
  it("resolves typed values", () => {
    const resolved = resolveEntitlements([{ key: "max_profiles", int_value: 10, bool_value: null }, { key: "custom_domain", int_value: null, bool_value: true }]);
    expect(resolved.limits.max_profiles).toBe(10);
    expect(resolved.features.custom_domain).toBe(true);
  });

  it("fails closed on missing or malformed values", () => {
    const resolved = resolveEntitlements([{ key: "max_profiles", int_value: -1, bool_value: null }, { key: "remove_badge", int_value: 1, bool_value: null }]);
    expect(resolved.limits.max_profiles).toBe(0);
    expect(resolved.limits.team_members).toBe(0);
    expect(resolved.features.remove_badge).toBe(false);
  });

  it("reports usage and asserts limits without plan-name checks", () => {
    const free = planEntitlementsFromProduct("free");
    expect(limitUsage(free, "max_profiles", 0)).toMatchObject({ remaining: 1, reached: false });
    expect(limitUsage(free, "max_profiles", 1)).toMatchObject({ remaining: 0, reached: true });
    expect(() => assertEntitlement(free, "max_profiles", 0)).not.toThrow();
    expect(() => assertEntitlement(free, "max_profiles", 1)).toThrow(EntitlementError);
    expect(() => assertFeature(free, "custom_domain")).toThrow(EntitlementError);
    expect(() => assertFeature(planEntitlementsFromProduct("pro"), "custom_domain")).not.toThrow();
  });
});
