import { BILLING_COPY } from "@/content/pt-BR";
import type { PlanId } from "@/lib/product";
import { planEntitlementsFromProduct } from "@/modules/entitlements";
import { seatUsage } from "@/modules/identity/invitations";
import { PLAN_IDS, isPaidPlan, planPrice, planRank, yearlySavingCents, type BillingInterval } from "./catalog";
import type { WorkspaceUsage } from "./downgrade-impact";
import type { BillingMode } from "./mode";
import { billingStateSentence, formatBillingDate, priceLabel } from "./presentation";
import type { InvoiceView, WorkspaceBilling } from "./read";
import { availableBillingActions, billingViewState, type BillingViewState } from "./subscription";

/**
 * What the plan screen shows (ADR 0014, UX-106), derived from the stored billing state. Pure: the
 * screen renders this and decides nothing else, and every command it offers re-authorizes on the
 * server and in the database. The gating is availableBillingActions, narrowed by who is looking,
 * whether plans are for sale and whether the workspace is suspended.
 */
export type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

export const STATE_TONE: Record<BillingViewState["kind"], Tone> = {
  free: "neutral", manual: "accent", incomplete: "warning", active: "success", canceling: "warning", downgrading: "warning", past_due: "danger", grace_expired: "danger", ended: "neutral",
};

export const INVOICE_TONE: Record<InvoiceView["status"], Tone> = { paid: "success", open: "warning", void: "neutral", uncollectible: "neutral" };

export interface PlanFact {
  key: "amount" | "nextCharge";
  label: string;
  value: string;
  /** Machine-readable instant for a date. */
  dateTime?: string;
}

/**
 * A running subscription is summed up as facts (what it costs, when it is charged next); every
 * other state keeps its one sentence, toned when the person has something to fix.
 */
export type PlanSummary = { kind: "facts"; facts: PlanFact[] } | { kind: "sentence"; text: string; tone: "neutral" | "warning" | "danger" };

/** Below the limit, exactly at it (nothing more can be added), or above it (after a cheaper plan). */
export type UsageLevel = "ok" | "full" | "over";

/**
 * One limit of the plan in force against what the workspace uses today. `used` is in the limit's
 * unit (megabytes for storage); `pending` counts open invitations, which hold seats.
 */
export interface PlanUsageRow {
  key: "pages" | "seats" | "storage";
  used: number;
  limit: number;
  level: UsageLevel;
  pending: number;
}

/** What a plan's card offers: a new subscription, a change of the running one, or nothing. */
export type PlanOffer = "subscribe" | "change" | null;

export interface PlanScreen {
  state: BillingViewState;
  selling: boolean;
  /** The plan in force: what the workspace may use today. */
  currentPlan: PlanId;
  summary: PlanSummary;
  /** Commands on the subscription for the owner while plans are for sale; null for anyone but the owner. */
  commands: { fixPayment: boolean; resume: boolean; managePayment: boolean; cancel: boolean } | null;
  /** The plan the resume confirmation names. */
  resumePlanId: PlanId | null;
  /** Monthly to yearly, for a subscription in good standing: what it saves and whether it is offered here. */
  yearly: { savingCents: number; offered: boolean } | null;
  /** The subscription is yearly: going back to monthly needs a new subscription. */
  yearlyOnly: boolean;
  /**
   * Which catalogue prices to show. A plan change keeps the subscription's interval, so a running
   * subscription sees its own; otherwise the person picks monthly or yearly.
   */
  prices: { kind: "fixed"; interval: BillingInterval } | { kind: "choice"; initial: BillingInterval };
  offers: Record<PlanId, PlanOffer>;
  /** The payment history is the owner's (RLS returns nobody else invoices). */
  showHistory: boolean;
  /** Usage against the plan in force; null when it could not be read (the screen then leaves it out). */
  usage: PlanUsageRow[] | null;
}

export interface PlanScreenInput {
  billing: WorkspaceBilling;
  mode: BillingMode;
  isOwner: boolean;
  suspended: boolean;
  now: Date;
  usage: WorkspaceUsage | null;
}

const SENTENCE_TONE: Partial<Record<BillingViewState["kind"], "warning" | "danger">> = { incomplete: "warning", past_due: "danger", grace_expired: "danger" };

function summaryFor(state: BillingViewState, amountCents: number | null): PlanSummary {
  if (state.kind === "active") {
    const facts: PlanFact[] = [];
    if (amountCents !== null) facts.push({ key: "amount", label: BILLING_COPY.current.amount, value: priceLabel(amountCents, state.interval) });
    const date = formatBillingDate(state.renewsAt);
    if (date && state.renewsAt) facts.push({ key: "nextCharge", label: BILLING_COPY.current.nextCharge, value: date, dateTime: state.renewsAt.toISOString() });
    if (facts.length > 0) return { kind: "facts", facts };
  }
  return { kind: "sentence", text: billingStateSentence(state, amountCents), tone: SENTENCE_TONE[state.kind] ?? "neutral" };
}

const BYTES_PER_MB = 1048576;

function level(used: number, limit: number): UsageLevel {
  return used > limit ? "over" : used >= limit ? "full" : "ok";
}

/** Limits of the plan the database grants today (`workspaces.plan_id`, ADR 0014), not of a plan only scheduled or lapsed. */
function usageRows(usage: WorkspaceUsage, planId: PlanId): PlanUsageRow[] {
  const { limits } = planEntitlementsFromProduct(planId);
  const seats = seatUsage(usage.members, usage.pendingInvitations, limits.team_members);
  const storageMb = usage.storageBytes / BYTES_PER_MB;
  return [
    { key: "pages", used: usage.pages, limit: limits.max_profiles, level: level(usage.pages, limits.max_profiles), pending: 0 },
    { key: "seats", used: seats.used, limit: seats.limit, level: level(seats.used, seats.limit), pending: seats.pending },
    { key: "storage", used: storageMb, limit: limits.storage_mb, level: level(storageMb, limits.storage_mb), pending: 0 },
  ];
}

export function planScreen({ billing, mode, isOwner, suspended, now, usage }: PlanScreenInput): PlanScreen {
  const selling = mode !== "off" && billing.deployed;
  const state = billingViewState(billing.record, billing.planId, now);
  const actions = availableBillingActions(state);
  const currentPlan: PlanId = state.kind === "free" || state.kind === "ended" ? "free" : state.planId;
  const subscribedInterval = billing.record && (state.kind === "active" || state.kind === "downgrading") ? billing.record.interval : null;
  // The plan the subscription is charged for: after a scheduled change to a cheaper plan it differs from the plan in force.
  const chargedPlan: PlanId | null = state.kind === "downgrading" ? state.nextPlanId : state.kind === "active" ? state.planId : null;
  const mayBuy = selling && isOwner && !suspended;

  const offers = Object.fromEntries(PLAN_IDS.map((planId): [PlanId, PlanOffer] => {
    if (!mayBuy || !isPaidPlan(planId)) return [planId, null];
    if (actions.subscribe) return [planId, "subscribe"];
    if (actions.changePlan && chargedPlan && planId !== chargedPlan && planRank(planId) !== planRank(chargedPlan)) return [planId, "change"];
    return [planId, null];
  })) as Record<PlanId, PlanOffer>;

  // Monthly to yearly is offered only to a subscription in good standing with nothing scheduled (the database checks it again).
  const yearly = state.kind === "active" && subscribedInterval === "month" && planPrice(state.planId, "year") ? { savingCents: yearlySavingCents(state.planId), offered: mayBuy } : null;

  return {
    state,
    selling,
    currentPlan,
    summary: summaryFor(state, billing.amountCents),
    commands: isOwner
      ? {
        fixPayment: selling && actions.fixPayment,
        resume: selling && actions.resume && billing.record !== null,
        managePayment: selling && (actions.changePlan || actions.cancel) && !actions.fixPayment,
        cancel: selling && actions.cancel,
      }
      : null,
    resumePlanId: billing.record?.planId ?? null,
    yearly,
    yearlyOnly: subscribedInterval === "year",
    prices: subscribedInterval ? { kind: "fixed", interval: subscribedInterval } : { kind: "choice", initial: "month" },
    offers,
    showHistory: isOwner && billing.deployed,
    usage: usage ? usageRows(usage, billing.planId) : null,
  };
}
