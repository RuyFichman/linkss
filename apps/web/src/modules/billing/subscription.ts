import type { PlanId } from "@/lib/product";
import { planRank, type BillingInterval } from "./catalog";

/**
 * Subscription state machine (ADR 0014, AC4). Pure: the clock is always an argument. The database
 * function private.apply_billing_snapshot implements the same rules and pgTAP runs the same cases;
 * change them together.
 *
 * The provider is the source of truth for payment state. What arrives here is an observation of
 * the provider's subscription *now* (the adapter fetched it), so the transition is "current row +
 * observation -> next row", not a reaction to an event name.
 */
export const SUBSCRIPTION_STATUSES = ["incomplete", "active", "past_due", "ended"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Days a failed payment keeps the paid plan (founder default; ADR 0014). */
export const GRACE_PERIOD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionObservation {
  status: SubscriptionStatus;
  planId: PlanId;
  interval: BillingInterval;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface SubscriptionRecord extends SubscriptionObservation {
  /** Set while the status is past_due: the paid plan is kept until this instant. */
  graceUntil: Date | null;
  /** After a paid-to-paid downgrade the plan already paid for is kept until the paid period ends. */
  heldPlanId: PlanId | null;
  heldUntil: Date | null;
}

export function graceDeadline(enteredAt: Date): Date {
  return new Date(enteredAt.getTime() + GRACE_PERIOD_DAYS * DAY_MS);
}

function heldIsValid(record: Pick<SubscriptionRecord, "heldPlanId" | "heldUntil">, now: Date): boolean {
  return record.heldPlanId !== null && record.heldUntil !== null && record.heldUntil.getTime() > now.getTime();
}

/**
 * Next stored row for an observation. `ended` is terminal for one provider subscription: a later
 * observation never brings it back (subscribing again creates another subscription).
 */
export function transition(current: SubscriptionRecord | null, observed: SubscriptionObservation, now: Date): SubscriptionRecord {
  if (current?.status === "ended") return current;

  // Grace starts once, when the failure is first seen, and is not restarted by later observations.
  const graceUntil = observed.status === "past_due" ? (current?.status === "past_due" && current.graceUntil ? current.graceUntil : graceDeadline(now)) : null;

  let heldPlanId: PlanId | null = null;
  let heldUntil: Date | null = null;
  const paying = observed.status === "active" || observed.status === "past_due";
  if (current && paying && (current.status === "active" || current.status === "past_due")) {
    if (heldIsValid(current, now)) {
      // An earlier downgrade is still inside its paid period: keep it unless the person upgraded back.
      if (planRank(observed.planId) < planRank(current.heldPlanId as PlanId)) ({ heldPlanId, heldUntil } = current);
    } else if (planRank(observed.planId) < planRank(current.planId) && current.currentPeriodEnd && current.currentPeriodEnd.getTime() > now.getTime()) {
      heldPlanId = current.planId;
      heldUntil = current.currentPeriodEnd;
    }
  }

  return { ...observed, graceUntil, heldPlanId, heldUntil };
}

/**
 * The plan a subscription grants at `now`, or null when it grants nothing (the workspace is then on
 * the free plan, or on a plan the founder set by hand before billing existed).
 */
export function grantedPlan(record: SubscriptionRecord | null, now: Date): PlanId | null {
  if (!record) return null;
  const plan = heldIsValid(record, now) ? (record.heldPlanId as PlanId) : record.planId;
  if (record.status === "active") return plan;
  if (record.status === "past_due") return record.graceUntil && record.graceUntil.getTime() > now.getTime() ? plan : null;
  return null;
}

/** One user-facing state per outcome (ADR 0014). The billing area and the banner render these and nothing else. */
export type BillingViewState =
  | { kind: "free" }
  /** A paid plan with no subscription behind it: set by hand before billing existed. Left alone. */
  | { kind: "manual"; planId: PlanId }
  /** Checkout finished but the first payment is not confirmed. Grants nothing yet. */
  | { kind: "incomplete"; planId: PlanId; interval: BillingInterval }
  | { kind: "active"; planId: PlanId; interval: BillingInterval; renewsAt: Date | null }
  /** Paid and cancelled: access holds until the end of the paid period. */
  | { kind: "canceling"; planId: PlanId; interval: BillingInterval; endsAt: Date | null }
  /** Downgraded to a cheaper paid plan: the plan already paid for holds until the period ends. */
  | { kind: "downgrading"; planId: PlanId; nextPlanId: PlanId; interval: BillingInterval; changesAt: Date }
  | { kind: "past_due"; planId: PlanId; interval: BillingInterval; graceUntil: Date }
  /** The grace period ended without payment: the paid plan is lost, the subscription still exists. */
  | { kind: "grace_expired"; planId: PlanId; interval: BillingInterval; expiredAt: Date | null }
  | { kind: "ended"; planId: PlanId };

export function billingViewState(record: SubscriptionRecord | null, workspacePlanId: PlanId, now: Date): BillingViewState {
  const manual = (): BillingViewState => (planRank(workspacePlanId) > 0 ? { kind: "manual", planId: workspacePlanId } : { kind: "free" });
  if (!record) return manual();
  const { planId, interval } = record;
  switch (record.status) {
    case "incomplete":
      return { kind: "incomplete", planId, interval };
    case "ended":
      return planRank(workspacePlanId) > 0 ? manual() : { kind: "ended", planId };
    case "past_due":
      return record.graceUntil && record.graceUntil.getTime() > now.getTime()
        ? { kind: "past_due", planId: grantedPlan(record, now) ?? planId, interval, graceUntil: record.graceUntil }
        : { kind: "grace_expired", planId, interval, expiredAt: record.graceUntil };
    case "active":
      if (record.cancelAtPeriodEnd) return { kind: "canceling", planId: grantedPlan(record, now) ?? planId, interval, endsAt: record.currentPeriodEnd };
      if (heldIsValid(record, now)) return { kind: "downgrading", planId: record.heldPlanId as PlanId, nextPlanId: planId, interval, changesAt: record.heldUntil as Date };
      return { kind: "active", planId, interval, renewsAt: record.currentPeriodEnd };
  }
}

/** What the owner may do next, derived from the state so the screen and the actions cannot disagree. */
export function availableBillingActions(state: BillingViewState): { subscribe: boolean; changePlan: boolean; cancel: boolean; resume: boolean; fixPayment: boolean } {
  const none = { subscribe: false, changePlan: false, cancel: false, resume: false, fixPayment: false };
  switch (state.kind) {
    case "free":
    case "manual":
    case "ended":
      return { ...none, subscribe: true };
    case "active":
    case "downgrading":
      return { ...none, changePlan: true, cancel: true };
    case "canceling":
      return { ...none, resume: true };
    case "past_due":
    case "grace_expired":
      return { ...none, fixPayment: true, cancel: true };
    case "incomplete":
      return { ...none, fixPayment: true };
  }
}
