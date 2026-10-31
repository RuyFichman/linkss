import { describe, expect, it } from "vitest";
import { MARKET_PRICES } from "@/lib/product";
import { PAID_PLAN_IDS, formatMoney, planPrice, yearlySavingCents } from "./catalog";
import { wholeFreeMonths, yearlyFreeMonths } from "./marketing";
import { priceListFor } from "./price-list";

describe("price lists (ADR 0022)", () => {
  it("shows the Brazilian catalogue on the Portuguese home", () => {
    const prices = priceListFor("pt-BR");
    expect(prices.currency).toBe("BRL");
    for (const planId of PAID_PLAN_IDS) {
      expect(prices.amountCents(planId, "month")).toBe(planPrice(planId, "month")?.amountCents);
      expect(prices.amountCents(planId, "year")).toBe(planPrice(planId, "year")?.amountCents);
      expect(prices.savingCents(planId)).toBe(yearlySavingCents(planId));
    }
    expect(prices.amountCents("free", "month")).toBeNull();
    expect(prices.freeMonths()).toBe(yearlyFreeMonths());
    expect(prices.format(1490)).toBe(formatMoney(1490));
  });

  it("shows the founder's euro prices on the Spanish home", () => {
    const prices = priceListFor("es-ES");
    expect(prices.currency).toBe("EUR");
    expect([prices.amountCents("pro", "month"), prices.amountCents("pro", "year")]).toEqual([400, 3900]);
    expect([prices.amountCents("agency", "month"), prices.amountCents("agency", "year")]).toEqual([1000, 9900]);
    expect(prices.amountCents("free", "month")).toBeNull();
    expect(prices.savingCents("pro")).toBe(900);
    expect(prices.savingCents("agency")).toBe(2100);
  });

  it("prices every paid plan in every market", () => {
    for (const market of Object.values(MARKET_PRICES)) expect(Object.keys(market.plans).sort()).toEqual([...PAID_PLAN_IDS].sort());
  });

  it("writes euros the Spanish way, without cents on whole amounts and with no-break spaces", () => {
    const prices = priceListFor("es-ES");
    expect(prices.format(400)).toBe("4 €");
    expect(prices.format(9900)).toBe("99 €");
    expect(prices.format(450)).toBe("4,50 €");
  });

  it("claims free months only when every plan leaves out the same whole number", () => {
    // 9 € and 21 € saved: 2.25 and 2.1 months, so the Spanish home shows no free-months label.
    expect(priceListFor("es-ES").freeMonths()).toBeNull();
    expect(wholeFreeMonths([{ month: 1000, year: 10000 }, { month: 500, year: 5000 }])).toBe(2);
    expect(wholeFreeMonths([{ month: 1000, year: 10000 }, { month: 500, year: 5500 }])).toBeNull();
    expect(wholeFreeMonths([])).toBeNull();
  });
});
