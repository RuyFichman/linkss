import { PAID_PLAN_IDS, planPrice } from "./catalog";

/**
 * How many monthly charges the yearly price leaves out, given each paid plan's two amounts. Null
 * unless it is the same whole number for every plan, so one label can never overstate the saving
 * of any plan.
 */
export function wholeFreeMonths(prices: readonly { month: number; year: number }[]): number | null {
  const months = prices.map(({ month, year }) => (month > 0 ? Math.max(0, month * 12 - year) / month : 0));
  const [first] = months;
  return first !== undefined && first >= 1 && Number.isInteger(first) && months.every((value) => value === first) ? first : null;
}

/** "2 meses grátis" next to the yearly choice, from the catalogue. */
export function yearlyFreeMonths(): number | null {
  return wholeFreeMonths(PAID_PLAN_IDS.map((planId) => ({ month: planPrice(planId, "month")?.amountCents ?? 0, year: planPrice(planId, "year")?.amountCents ?? 0 })));
}
