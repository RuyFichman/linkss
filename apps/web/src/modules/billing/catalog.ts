import { PRODUCT, type PlanId } from "@/lib/product";

/**
 * The one price catalogue (ADR 0014, AC1). The plans screen, the checkout request and the tests
 * read it; the `plan_prices` seed mirrors it and a drift test compares the two. Amounts are integer
 * cents with an explicit currency. Nothing here comes from the browser.
 */
export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export type BillingCurrency = typeof PRODUCT.currency;

export interface PlanPrice {
  planId: PlanId;
  interval: BillingInterval;
  amountCents: number;
  currency: BillingCurrency;
}

export const PLAN_IDS = Object.keys(PRODUCT.plans) as PlanId[];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as string[]).includes(value);
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && (BILLING_INTERVALS as readonly string[]).includes(value);
}

function amountFor(planId: PlanId, interval: BillingInterval): number {
  const plan = PRODUCT.plans[planId];
  return interval === "month" ? plan.monthlyPriceInCents : plan.yearlyPriceInCents;
}

/** A plan is sold when it has a price; the free plan has none. */
export function isPaidPlan(planId: PlanId): boolean {
  return amountFor(planId, "month") > 0;
}

export const PAID_PLAN_IDS: readonly PlanId[] = PLAN_IDS.filter(isPaidPlan);

export const PRICE_CATALOG: readonly PlanPrice[] = PAID_PLAN_IDS.flatMap((planId) =>
  BILLING_INTERVALS.map((interval) => ({ planId, interval, amountCents: amountFor(planId, interval), currency: PRODUCT.currency })),
);

export function planPrice(planId: PlanId, interval: BillingInterval): PlanPrice | null {
  return PRICE_CATALOG.find((price) => price.planId === planId && price.interval === interval) ?? null;
}

/**
 * The plan a charge pays for. A subscription grants the plan whose catalogue price it is actually
 * charged, never a plan named in metadata: every (interval, amount) pair is unique in the catalogue
 * (tested), so the answer is unambiguous. The database applies the same rule (plan_prices).
 */
export function planForCharge(amountCents: number, currency: string, interval: string): PlanId | null {
  const match = PRICE_CATALOG.find((price) => price.amountCents === amountCents && price.currency === currency.toUpperCase() && price.interval === interval);
  return match?.planId ?? null;
}

/** Orders plans by what they cost per month (free is 0). Used to tell an upgrade from a downgrade without naming plans. */
export function planRank(planId: PlanId): number {
  return amountFor(planId, "month");
}

/** What paying yearly saves against twelve monthly charges, in cents. */
export function yearlySavingCents(planId: PlanId): number {
  return Math.max(0, amountFor(planId, "month") * 12 - amountFor(planId, "year"));
}

const MONEY = new Intl.NumberFormat("pt-BR", { style: "currency", currency: PRODUCT.currency });

/** "R$ 14,90". Ordinary spaces, so the text can be compared and copied. */
export function formatMoney(amountCents: number): string {
  return MONEY.format(amountCents / 100).replace(/\s/g, " ");
}
