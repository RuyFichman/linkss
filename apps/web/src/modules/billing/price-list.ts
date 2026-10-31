import type { Locale } from "@/lib/locale";
import { MARKET_PRICES, type PlanId } from "@/lib/product";
import { PAID_PLAN_IDS, formatMoney, planPrice, yearlySavingCents, type BillingInterval } from "./catalog";
import { wholeFreeMonths, yearlyFreeMonths } from "./marketing";

/**
 * The amounts a marketing page shows, in the currency of its market (ADR 0022). Brazil reads the
 * price catalogue; another market reads MARKET_PRICES, which nothing charges yet.
 */
export interface PriceList {
  currency: string;
  /** Null for a plan that is not sold in that interval (the free plan has no amount). */
  amountCents(planId: PlanId, interval: BillingInterval): number | null;
  /** What paying yearly saves against twelve monthly charges. */
  savingCents(planId: PlanId): number;
  /** The whole number of months the yearly price leaves out for every plan, or null. */
  freeMonths(): number | null;
  format(amountCents: number): string;
  /** The free plan's price, "R$ 0" or "0 €". */
  free: string;
}

const CATALOGUE: PriceList = {
  currency: "BRL",
  amountCents: (planId, interval) => planPrice(planId, interval)?.amountCents ?? null,
  savingCents: yearlySavingCents,
  freeMonths: yearlyFreeMonths,
  format: formatMoney,
  free: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(0).replace(/\s/g, "\u00a0"),
};

type MarketPlan = { monthlyPriceInCents: number; yearlyPriceInCents: number };

function marketList(locale: Exclude<Locale, "pt-BR">): PriceList {
  const market = MARKET_PRICES[locale];
  const plans: Partial<Record<PlanId, MarketPlan>> = market.plans;
  const amount = (planId: PlanId, interval: BillingInterval) => {
    const plan = plans[planId];
    if (!plan) return null;
    return interval === "month" ? plan.monthlyPriceInCents : plan.yearlyPriceInCents;
  };
  const whole = new Intl.NumberFormat(locale, { style: "currency", currency: market.currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const cents = new Intl.NumberFormat(locale, { style: "currency", currency: market.currency });
  return {
    currency: market.currency,
    amountCents: amount,
    savingCents: (planId) => Math.max(0, (amount(planId, "month") ?? 0) * 12 - (amount(planId, "year") ?? 0)),
    freeMonths: () => wholeFreeMonths(PAID_PLAN_IDS.map((planId) => ({ month: amount(planId, "month") ?? 0, year: amount(planId, "year") ?? 0 }))),
    // "4 €" for a whole amount, "4,50 €" otherwise; no-break spaces, as formatMoney does.
    free: whole.format(0).replace(/\s/g, "\u00a0"),
    format: (amountCents) => (amountCents % 100 === 0 ? whole : cents).format(amountCents / 100).replace(/\s/g, " "),
  };
}

export function priceListFor(locale: Locale): PriceList {
  return locale === "pt-BR" ? CATALOGUE : marketList(locale);
}
