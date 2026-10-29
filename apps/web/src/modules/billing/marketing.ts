import { PAID_PLAN_IDS, planPrice, yearlySavingCents } from "./catalog";
import type { BillingMode } from "./mode";

/**
 * Whether public marketing may present paid plans as something a visitor can buy (ADR 0014,
 * AGENTS.md §10: marketing describes what exists in the deployed product). Only with live billing.
 * In `sandbox` a checkout exists, but it charges nobody and is not an offer; in `off` there is
 * none. In both the home keeps listing paid plans as "em breve", without prices.
 */
export function paidPlansAreOnSale(mode: BillingMode): boolean {
  return mode === "live";
}

/**
 * How many monthly charges the yearly price leaves out ("2 meses grátis" next to the yearly choice).
 * Null unless it is the same whole number for every paid plan, so one label can never overstate the
 * saving of any plan.
 */
export function yearlyFreeMonths(): number | null {
  const months = PAID_PLAN_IDS.map((planId) => {
    const monthly = planPrice(planId, "month")?.amountCents ?? 0;
    return monthly > 0 ? yearlySavingCents(planId) / monthly : 0;
  });
  const [first] = months;
  return first !== undefined && first >= 1 && Number.isInteger(first) && months.every((value) => value === first) ? first : null;
}
