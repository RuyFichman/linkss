import { describe, expect, it } from "vitest";
import { PRODUCT } from "./product";

describe("product configuration", () => {
  it("keeps approved launch prices in integer cents", () => {
    expect(PRODUCT.plans.pro.monthlyPriceInCents).toBe(1490);
    expect(PRODUCT.plans.agency.monthlyPriceInCents).toBe(5790);
  });

  it("models the agency plan as multi-profile", () => {
    expect(PRODUCT.plans.agency.includedProfiles).toBeGreaterThan(1);
  });
});
