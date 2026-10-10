import { BILLING_COPY } from "@/content/pt-BR";
import type { PlanId } from "@/lib/product";
import { planEntitlementsFromProduct } from "@/modules/entitlements";
import { can, type WorkspaceRole } from "@/modules/identity/permissions";
import { formatMoney, type BillingInterval } from "./catalog";
import type { ImpactItem } from "./downgrade-impact";
import type { BillingMode } from "./mode";
import type { BillingViewState } from "./subscription";

/**
 * Words for billing states (ADR 0014). Pure: each state and each impact line maps to exactly one
 * sentence, so the billing area, the banner and the confirmation cannot describe the same thing in
 * two ways. Dates are shown in São Paulo time, like the rest of the product.
 */
const DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

/** "09/10/2026", or an empty string when there is no date. */
export function formatBillingDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "" : DATE.format(date);
}

/**
 * What a plan includes, generated from its entitlements (never typed by hand per plan).
 * `customDomains: false` leaves the custom-domain line out: the screen lists what works in this
 * environment, and custom domains need their own configuration (ADR 0016).
 */
export function planFeatureLines(planId: PlanId, options: { customDomains?: boolean } = {}): string[] {
  const { limits, features } = planEntitlementsFromProduct(planId);
  const copy = BILLING_COPY.features;
  return [
    copy.max_profiles(limits.max_profiles),
    copy.team_members(limits.team_members),
    copy.analytics_days(limits.analytics_days),
    copy.storage_mb(limits.storage_mb),
    features.remove_badge ? copy.remove_badge.on : copy.remove_badge.off,
    features.shareable_reports ? copy.shareable_reports.on : copy.shareable_reports.off,
    ...(options.customDomains === false ? [] : [features.custom_domain ? copy.custom_domain.on : copy.custom_domain.off]),
    features.tracking_pixels ? copy.tracking_pixels.on : copy.tracking_pixels.off,
  ];
}

export function priceLabel(amountCents: number, interval: BillingInterval): string {
  return `${formatMoney(amountCents)} ${BILLING_COPY.perInterval[interval]}`;
}

export function billingStateSentence(state: BillingViewState, amountCents: number | null): string {
  const copy = BILLING_COPY.state;
  const name = (planId: PlanId) => BILLING_COPY.planNames[planId];
  switch (state.kind) {
    case "free":
      return copy.free;
    case "manual":
      return copy.manual(name(state.planId));
    case "incomplete":
      return copy.incomplete(name(state.planId));
    case "active": {
      const interval = BILLING_COPY.intervalAdjective[state.interval];
      const date = formatBillingDate(state.renewsAt);
      return date && amountCents !== null ? copy.active(name(state.planId), interval, formatMoney(amountCents), date) : copy.activeNoDate(name(state.planId), interval);
    }
    case "canceling":
      return copy.canceling(name(state.planId), formatBillingDate(state.endsAt));
    case "downgrading":
      return copy.downgrading(name(state.planId), name(state.nextPlanId), formatBillingDate(state.changesAt));
    case "past_due":
      return copy.past_due(name(state.planId), formatBillingDate(state.graceUntil));
    case "grace_expired":
      return copy.grace_expired(name(state.planId), formatBillingDate(state.expiredAt));
    case "ended":
      return copy.ended(name(state.planId));
  }
}

/** The banner shown across a workspace while a payment is failing; null in every other state. */
export function billingBannerSentence(state: BillingViewState): string | null {
  if (state.kind === "past_due") return BILLING_COPY.banner.past_due(BILLING_COPY.planNames[state.planId], formatBillingDate(state.graceUntil));
  if (state.kind === "grace_expired") return BILLING_COPY.banner.grace_expired(BILLING_COPY.planNames[state.planId]);
  return null;
}

export function impactSentence(item: ImpactItem): string {
  const copy = BILLING_COPY.impact;
  switch (item.key) {
    case "max_profiles":
      return item.kind === "kept" ? copy.pagesKept(item.used, item.limit) : copy.pagesOver(item.over, item.used, item.limit);
    case "team_members":
      return item.kind === "kept" ? copy.seatsKept(item.used, item.limit) : copy.seatsOver(item.members, item.pendingInvitations, item.limit);
    case "storage_mb":
      return item.kind === "kept" ? copy.storageKept(item.usedMb, item.limitMb) : copy.storageOver(item.usedMb, item.limitMb);
    case "analytics_days":
      return item.kind === "kept" ? copy.historyKept(item.to) : copy.historyStops(item.from, item.to);
    case "shareable_reports":
      return item.kind === "kept" ? copy.reportsKept : copy.reportsStop(item.activeLinks);
    case "remove_badge":
      return item.kind === "kept" ? copy.badgeKept : copy.badgeStops;
    case "custom_domain":
      return item.kind === "kept" ? copy.domainsKept(item.domains) : copy.domainsStop(item.domains);
    case "tracking_pixels":
      return item.kind === "kept" ? copy.pixelsKept(item.pages) : copy.pixelsStop(item.pages);
  }
}

/**
 * Where a limit screen sends a person who can act on it, or null. Null keeps the screen exactly as
 * it was before billing: when billing is off, and for roles that cannot buy.
 */
export function upgradeHref(mode: BillingMode, role: WorkspaceRole | null | undefined, workspaceId: string): string | null {
  return mode !== "off" && can(role, "billing.manage") ? `/app/w/${workspaceId}/plano` : null;
}
