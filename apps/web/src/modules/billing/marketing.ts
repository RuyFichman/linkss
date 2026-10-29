import { PAID_PLAN_IDS, planPrice, yearlySavingCents } from "./catalog";

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
