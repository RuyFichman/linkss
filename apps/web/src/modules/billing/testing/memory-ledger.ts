import type { PlanId } from "@/lib/product";
import { signBillingMessage } from "../attestation";
import { planForCharge, isBillingInterval } from "../catalog";
import type { ApplyOutcome, SnapshotSink } from "../service";
import { SUBSCRIPTION_STATUSES, grantedPlan, transition, type SubscriptionRecord } from "../subscription";

/**
 * In-memory stand-in for private.apply_billing_snapshot, for unit tests of the code around it
 * (webhook processing, the owner actions, the job). It follows the same steps in the same order
 * (signature, shape, freshness, ledger, customer, price, staleness, transition, plan) using the
 * pure functions the product ships. The SQL itself is proved by pgTAP (170-billing.test.sql); the
 * two share the cases, not the code.
 */
interface StoredSubscription extends SubscriptionRecord {
  id: string;
  workspaceId: string;
  observedAt: Date;
  /** What this subscription last wrote to the workspace's plan. */
  granted: PlanId | null;
}

export function createMemoryLedger(options: { signingSecret: string; now: () => Date }) {
  const customers = new Map<string, string>();
  const plans = new Map<string, PlanId>();
  const events = new Map<string, string>();
  const subscriptions = new Map<string, StoredSubscription>();
  const audit: Array<{ workspaceId: string; action: string; from?: string; to?: string; reason: string }> = [];
  let applyCalls = 0;
  let down = false;

  const answer = (status: ApplyOutcome["status"], planChanged = false, slugs: string[] = []): ApplyOutcome => ({ status, planChanged, slugs });

  /** Mirror of private.billing_sync_plan. */
  function syncPlan(subscription: StoredSubscription, now: Date, reason: string): boolean {
    const grant = grantedPlan(subscription, now);
    const target = grant ?? (subscription.granted ? "free" : null);
    subscription.granted = grant;
    if (!target) return false;
    const current = plans.get(subscription.workspaceId) ?? "free";
    if (current === target) return false;
    plans.set(subscription.workspaceId, target);
    audit.push({ workspaceId: subscription.workspaceId, action: "billing.plan_changed", from: current, to: target, reason });
    return true;
  }

  const sink: SnapshotSink = {
    async apply(payload, signature) {
      applyCalls += 1;
      if (down) throw new Error("Billing snapshot failed: 08006");
      if (signature !== signBillingMessage(payload, options.signingSecret)) return answer("forbidden");
      let snapshot: Record<string, unknown>;
      try {
        snapshot = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        return answer("invalid");
      }
      const eventId = typeof snapshot.event_id === "string" ? snapshot.event_id : "";
      const customerId = typeof snapshot.customer_id === "string" ? snapshot.customer_id : "";
      const reason = typeof snapshot.reason === "string" ? snapshot.reason : "";
      const observedAt = new Date(String(snapshot.observed_at));
      if (snapshot.v !== 1 || !eventId || !customerId || Number.isNaN(observedAt.getTime())) return answer("invalid");
      const now = options.now();
      if (observedAt.getTime() > now.getTime() + 5 * 60_000 || observedAt.getTime() < now.getTime() - 15 * 60_000) return answer("expired");

      if (events.has(eventId)) return answer("duplicate");
      const record = (status: ApplyOutcome["status"], planChanged = false): ApplyOutcome => {
        events.set(eventId, status);
        return answer(status, planChanged, planChanged ? [`pagina-${customerId.slice(-4)}`] : []);
      };

      const workspaceId = customers.get(customerId);
      if (!workspaceId) return record("unknown_customer");
      const raw = snapshot.subscription as Record<string, unknown> | null;
      if (raw === null) return record("ignored");
      if (raw.workspace_id !== workspaceId) return record("customer_mismatch");
      const status = SUBSCRIPTION_STATUSES.find((value) => value === raw.status);
      if (!status || !isBillingInterval(raw.interval) || typeof raw.amount_cents !== "number" || typeof raw.id !== "string") return answer("invalid");
      const planId = planForCharge(raw.amount_cents, String(raw.currency), raw.interval);
      if (!planId) return record("price_mismatch");

      const existing = subscriptions.get(raw.id);
      if (existing) {
        if (existing.workspaceId !== workspaceId) return record("customer_mismatch");
        if (observedAt.getTime() < existing.observedAt.getTime()) return record("stale");
        if (existing.status === "ended") return record("unchanged");
      } else if ((status === "active" || status === "past_due") && [...subscriptions.values()].some((item) => item.workspaceId === workspaceId && (item.status === "active" || item.status === "past_due"))) {
        return record("conflict");
      }

      const next = transition(existing ?? null, { status, planId, interval: raw.interval, currentPeriodEnd: raw.current_period_end ? new Date(String(raw.current_period_end)) : null, cancelAtPeriodEnd: raw.cancel_at_period_end === true }, now);
      const changed = !existing || existing.status !== next.status || existing.planId !== next.planId || existing.interval !== next.interval || existing.cancelAtPeriodEnd !== next.cancelAtPeriodEnd
        || existing.currentPeriodEnd?.getTime() !== next.currentPeriodEnd?.getTime();
      const stored: StoredSubscription = { ...next, id: raw.id, workspaceId, observedAt, granted: existing?.granted ?? null };
      subscriptions.set(raw.id, stored);
      if (changed) audit.push({ workspaceId, action: "billing.subscription_changed", reason });
      const planChanged = syncPlan(stored, now, reason);
      return record(changed || planChanged ? "applied" : "unchanged", planChanged);
    },
  };

  return {
    sink,
    audit,
    registerCustomer(workspaceId: string, customerId: string): void {
      customers.set(customerId, workspaceId);
    },
    customerOf(workspaceId: string): string | null {
      return [...customers.entries()].find(([, workspace]) => workspace === workspaceId)?.[0] ?? null;
    },
    setPlan(workspaceId: string, planId: PlanId): void {
      plans.set(workspaceId, planId);
    },
    planOf(workspaceId: string): PlanId {
      return plans.get(workspaceId) ?? "free";
    },
    subscriptionsOf(workspaceId: string): StoredSubscription[] {
      return [...subscriptions.values()].filter((subscription) => subscription.workspaceId === workspaceId);
    },
    liveSubscription(workspaceId: string): StoredSubscription | null {
      return [...subscriptions.values()].find((subscription) => subscription.workspaceId === workspaceId && (subscription.status === "active" || subscription.status === "past_due")) ?? null;
    },
    outcomeOf(eventId: string): string | null {
      return events.get(eventId) ?? null;
    },
    applyCalls: () => applyCalls,
    setDown(value: boolean): void {
      down = value;
    },
    /** Mirror of the clock part of public.run_billing_maintenance. */
    tick(now: Date): { graceExpired: number; holdsReleased: number; planChanges: number } {
      const result = { graceExpired: 0, holdsReleased: 0, planChanges: 0 };
      for (const subscription of subscriptions.values()) {
        if (subscription.status === "ended") continue;
        const graceDue = subscription.status === "past_due" && subscription.graceUntil !== null && subscription.graceUntil.getTime() <= now.getTime() && subscription.granted !== null;
        const holdDue = subscription.heldUntil !== null && subscription.heldUntil.getTime() <= now.getTime();
        if (!graceDue && !holdDue) continue;
        if (holdDue) Object.assign(subscription, { heldPlanId: null, heldUntil: null });
        if (syncPlan(subscription, now, graceDue ? "grace_expired" : "held_period_ended")) result.planChanges += 1;
        if (graceDue) result.graceExpired += 1;
        else result.holdsReleased += 1;
      }
      return result;
    },
  };
}

export type MemoryLedger = ReturnType<typeof createMemoryLedger>;
