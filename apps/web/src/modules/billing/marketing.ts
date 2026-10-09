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
