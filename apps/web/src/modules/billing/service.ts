import { createHash } from "node:crypto";
import type { PlanId } from "@/lib/product";
import { AuthorizationError, requireWorkspaceAccess, type IdentityPort } from "@/modules/identity/guard";
import { PaymentsError, type PaymentsAdapter } from "./adapter";
import { MAX_SNAPSHOT_INVOICES, serializeBillingSnapshot, signBillingMessage, customerRegistrationMessage, type SnapshotReason } from "./attestation";
import { isBillingInterval, isPaidPlan, isPlanId, planPrice, planRank, type BillingInterval } from "./catalog";
import type { BillingMode } from "./mode";

/**
 * Billing use cases (ADR 0014), independent of Next.js and of Supabase.
 *
 * One rule runs through all of them: the product never writes payment state from what a request
 * says. It reads the provider (through the adapter), signs what it read and hands it to the
 * database, which is the only place that turns it into a plan. A webhook is therefore only a hint
 * that something changed; its payload decides nothing, which is also what makes duplicated,
 * delayed and reordered deliveries harmless.
 */

// ---------------------------------------------------------------------------------------------
// Snapshot: provider -> signed text -> database
// ---------------------------------------------------------------------------------------------

export const APPLY_STATUSES = [
  "applied", "unchanged", "duplicate", "stale", "ignored", "expired", "unknown_customer", "customer_mismatch", "price_mismatch",
  "conflict", "invalid", "forbidden", "not_configured", "not_deployed",
] as const;
export type ApplyStatus = (typeof APPLY_STATUSES)[number];

export interface ApplyOutcome {
  status: ApplyStatus;
  planChanged: boolean;
  /** Addresses of the workspace's pages on the air, when the plan changed: their cached copies are dropped. */
  slugs: string[];
}

/** The database side of the snapshot path. Throws when the database cannot be reached. */
export interface SnapshotSink {
  apply(payload: string, signature: string): Promise<ApplyOutcome>;
}

const SLUG = /^[a-z0-9-]{3,40}$/;

export function parseApplyOutcome(raw: unknown): ApplyOutcome {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const status = APPLY_STATUSES.find((value) => value === row.status) ?? "invalid";
  const slugs = Array.isArray(row.slugs) ? row.slugs.filter((slug): slug is string => typeof slug === "string" && SLUG.test(slug)) : [];
  return { status, planChanged: row.plan_changed === true, slugs };
}

export interface SyncDeps {
  adapter: PaymentsAdapter;
  sink: SnapshotSink;
  signingSecret: string;
  now: () => Date;
}

/** Reads what the provider says now about one customer's subscription and hands it, signed, to the database. */
export async function syncFromProvider(deps: SyncDeps, input: { eventId: string; reason: SnapshotReason; customerId: string; subscriptionId: string | null }): Promise<ApplyOutcome> {
  const subscription = input.subscriptionId ? await deps.adapter.fetchSubscription(input.subscriptionId) : await deps.adapter.findCustomerSubscription(input.customerId);
  const invoices = subscription ? await deps.adapter.listInvoices(subscription.id, MAX_SNAPSHOT_INVOICES) : [];
  // The clock is read after the provider answered: "observed at" is when the state was true.
  const payload = serializeBillingSnapshot({ provider: deps.adapter.provider, eventId: input.eventId, reason: input.reason, observedAt: deps.now(), customerId: input.customerId, subscription, invoices });
  const outcome = await deps.sink.apply(payload, signBillingMessage(payload, deps.signingSecret));
  if (outcome.status === "conflict" && subscription) {
    // A second paying subscription for a workspace that already has one. It was not stored; stop
    // it at the provider so it is not charged again. The refund is a manual step (runbook BILLING).
    await deps.adapter.cancelNow(subscription.id);
  }
  return outcome;
}

// ---------------------------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------------------------

export type WebhookOutcome = ApplyStatus | "missing_signature" | "bad_signature" | "stale_timestamp" | "malformed" | "unavailable";

export interface WebhookResult {
  /** 200: done, do not send again. 400: not ours or not valid. 503: try again later. */
  http: 200 | 400 | 503;
  outcome: WebhookOutcome;
  topic: string | null;
  planChanged: boolean;
  slugs: string[];
}

// Until billing is configured or migrated the provider should keep the event and retry.
const RETRY_LATER: readonly ApplyStatus[] = ["not_configured", "not_deployed", "forbidden"];

export async function processWebhook(deps: SyncDeps, input: { rawBody: string; signatureHeader: string | null }): Promise<WebhookResult> {
  const verified = deps.adapter.verifyWebhook({ rawBody: input.rawBody, signatureHeader: input.signatureHeader, now: deps.now() });
  if (!verified.ok) return { http: 400, outcome: verified.reason, topic: null, planChanged: false, slugs: [] };
  const { event } = verified;
  const done = (outcome: WebhookOutcome, extra: Partial<WebhookResult> = {}): WebhookResult => ({ http: 200, outcome, topic: event.topic, planChanged: false, slugs: [], ...extra });
  if (event.topic === "other") return done("ignored");

  try {
    const customerId = event.customerId ?? (event.chargeId ? await deps.adapter.findChargeCustomer(event.chargeId) : null);
    if (!customerId) return done("ignored");

    let subscriptionId = event.subscriptionId;
    if (event.topic === "dispute") {
      // A chargeback ends the paid plan at once: the subscription is cancelled at the provider and
      // the snapshot below then reports it as ended.
      const disputed = await deps.adapter.findCustomerSubscription(customerId);
      if (disputed && disputed.status !== "ended") await deps.adapter.cancelNow(disputed.id);
      subscriptionId = disputed?.id ?? null;
    }

    const outcome = await syncFromProvider(deps, { eventId: event.id, reason: event.topic === "dispute" ? "dispute" : "webhook", customerId, subscriptionId });
    return done(outcome.status, { http: RETRY_LATER.includes(outcome.status) ? 503 : 200, planChanged: outcome.planChanged, slugs: outcome.slugs });
  } catch {
    // The provider or the database did not answer. Nothing was committed: the provider retries.
    return { http: 503, outcome: "unavailable", topic: event.topic, planChanged: false, slugs: [] };
  }
}

// ---------------------------------------------------------------------------------------------
// Maintenance job: the clock, and the repair for a lost webhook
// ---------------------------------------------------------------------------------------------

export interface MaintenanceTick {
  graceExpired: number;
  holdsReleased: number;
  planChanges: number;
  purgedEvents: number;
  pending: number;
  slugs: string[];
  candidates: Array<{ subscriptionId: string; customerId: string }>;
}

export function parseMaintenanceTick(raw: unknown): MaintenanceTick {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const integer = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  return {
    graceExpired: integer(row.grace_expired),
    holdsReleased: integer(row.holds_released),
    planChanges: integer(row.plan_changes),
    purgedEvents: integer(row.purged_events),
    pending: integer(row.pending),
    slugs: Array.isArray(row.slugs) ? row.slugs.filter((slug): slug is string => typeof slug === "string" && SLUG.test(slug)) : [],
    candidates: candidates.flatMap((item) => {
      const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return typeof entry.subscription_id === "string" && typeof entry.customer_id === "string" ? [{ subscriptionId: entry.subscription_id, customerId: entry.customer_id }] : [];
    }),
  };
}

export interface MaintenanceReport {
  graceExpired: number;
  holdsReleased: number;
  planChanges: number;
  purgedEvents: number;
  /** Subscriptions read again at the provider in this run. */
  checked: number;
  /** Of those, how many the database copy had wrong: each one is a webhook that was lost. */
  corrected: number;
  failed: number;
  /** Subscriptions still waiting for a check after this run's bound. */
  pending: number;
  slugs: string[];
}

/**
 * `tick` applies what only time causes (grace ended, held period ended) and lists the subscriptions
 * to read again. Without a provider (billing off) the clock still runs and nothing is re-read.
 */
export async function runBillingMaintenance(deps: { tick: () => Promise<MaintenanceTick>; sync: SyncDeps | null }): Promise<MaintenanceReport> {
  const tick = await deps.tick();
  const report: MaintenanceReport = { graceExpired: tick.graceExpired, holdsReleased: tick.holdsReleased, planChanges: tick.planChanges, purgedEvents: tick.purgedEvents, checked: 0, corrected: 0, failed: 0, pending: tick.pending, slugs: [...tick.slugs] };
  if (!deps.sync) return { ...report, pending: tick.pending + tick.candidates.length };
  for (const candidate of tick.candidates) {
    try {
      const outcome = await syncFromProvider(deps.sync, { eventId: `reconcile:${candidate.subscriptionId}:${deps.sync.now().toISOString()}`, reason: "reconciliation", customerId: candidate.customerId, subscriptionId: candidate.subscriptionId });
      report.checked += 1;
      if (outcome.status === "applied") report.corrected += 1;
      else if (outcome.status !== "unchanged") report.failed += 1;
      if (outcome.planChanged) report.planChanges += 1;
      report.slugs.push(...outcome.slugs);
    } catch {
      report.failed += 1;
    }
  }
  return report;
}

// ---------------------------------------------------------------------------------------------
// Owner actions
// ---------------------------------------------------------------------------------------------

export type BillingErrorKind =
  | "unauthenticated" | "not_found" | "forbidden"
  | "billing_off" | "invalid_plan" | "already_subscribed" | "rate_limited" | "no_subscription" | "invalid_state" | "same_plan"
  | "not_deployed" | "not_configured" | "provider_unavailable" | "provider_rejected" | "unavailable";

export type BillingResult<T> = { ok: true; value: T } | { ok: false; error: BillingErrorKind };
export type BillingRepositoryResult<T> = { ok: true; value: T } | { ok: false; error: BillingErrorKind };

export interface SubscriptionHandle {
  subscriptionId: string;
  customerId: string;
  planId: string;
  interval: BillingInterval;
  /** For a plan change: the target plan's catalogue amount as the database holds it. */
  amountCents: number;
}

/** Persistence port. The Supabase implementation runs as the signed-in user: RLS and the RPCs check the role again. */
export interface BillingRepository {
  workspaceName(workspaceId: string): Promise<string | null>;
  beginCheckout(workspaceId: string, planId: PlanId, interval: BillingInterval): Promise<BillingRepositoryResult<null>>;
  findCustomerId(workspaceId: string): Promise<string | null>;
  registerCustomer(workspaceId: string, customerId: string, signature: string): Promise<BillingRepositoryResult<string>>;
  beginChange(workspaceId: string, kind: "cancel" | "resume" | "change_plan", planId: PlanId | null): Promise<BillingRepositoryResult<SubscriptionHandle>>;
}

export interface BillingServiceDeps {
  identity: IdentityPort;
  repository: BillingRepository;
  mode: BillingMode;
  /** Null when billing is off. */
  sync: SyncDeps | null;
  /** Absolute URL of a path of the application (from configuration, never from the request). */
  appUrl: (path: string) => string;
  /** What the provider shows on its checkout page and invoices. */
  productName: (planId: PlanId) => string;
  newId: () => string;
}

export function billingReturnPath(workspaceId: string, result: "sucesso" | "cancelado"): string {
  return `/app/w/${workspaceId}/plano/retorno?resultado=${result}`;
}

export function billingHomePath(workspaceId: string): string {
  return `/app/w/${workspaceId}/plano`;
}

/** Same workspace, plan and interval inside ten minutes: the same checkout, not a second one. */
export function checkoutIdempotencyKey(workspaceId: string, planId: string, interval: string, now: Date): string {
  const bucket = Math.floor(now.getTime() / 600_000);
  return `lnk-co-${createHash("sha256").update(`${workspaceId}:${planId}:${interval}:${bucket}`).digest("hex").slice(0, 40)}`;
}

function fromProvider(error: unknown): BillingErrorKind {
  if (error instanceof PaymentsError) return error.kind === "unavailable" ? "provider_unavailable" : "provider_rejected";
  return "unavailable";
}

export function createBillingService(deps: BillingServiceDeps) {
  const { identity, repository } = deps;

  /** Only the owner pays, changes the plan and cancels (ADR 0014). Checked here and again in the database. */
  async function authorize(workspaceId: unknown): Promise<BillingResult<string>> {
    try {
      const access = await requireWorkspaceAccess(identity, workspaceId, "billing.manage");
      return { ok: true, value: access.workspaceId };
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      return { ok: false, error: error.reason };
    }
  }

  /** After a change at the provider, copy the new state now instead of waiting for the webhook. */
  async function syncAfterAction(sync: SyncDeps, handle: SubscriptionHandle): Promise<{ planChanged: boolean; slugs: string[] }> {
    try {
      const outcome = await syncFromProvider(sync, { eventId: `action:${deps.newId()}`, reason: "owner_action", customerId: handle.customerId, subscriptionId: handle.subscriptionId });
      return { planChanged: outcome.planChanged, slugs: outcome.slugs };
    } catch {
      // The provider accepted the change; the webhook or the daily reconciliation brings the copy up to date.
      return { planChanged: false, slugs: [] };
    }
  }

  return {
    /**
     * Opens the provider's hosted checkout. The plan and the interval are validated; the amount is
     * read from the catalogue here, on the server. The browser supplies neither a price nor a customer.
     */
    async startCheckout(workspaceId: unknown, planId: unknown, interval: unknown): Promise<BillingResult<{ url: string }>> {
      const authorized = await authorize(workspaceId);
      if (!authorized.ok) return authorized;
      if (deps.mode === "off" || !deps.sync) return { ok: false, error: "billing_off" };
      if (!isPlanId(planId) || !isPaidPlan(planId) || !isBillingInterval(interval)) return { ok: false, error: "invalid_plan" };
      const price = planPrice(planId, interval);
      if (!price) return { ok: false, error: "invalid_plan" };
      const { adapter, signingSecret, now } = deps.sync;

      const begun = await repository.beginCheckout(authorized.value, planId, interval);
      if (!begun.ok) return begun;

      try {
        let customerId = await repository.findCustomerId(authorized.value);
        if (!customerId) {
          const created = await adapter.createCustomer({ workspaceId: authorized.value, workspaceName: (await repository.workspaceName(authorized.value)) ?? authorized.value });
          const registered = await repository.registerCustomer(authorized.value, created.customerId, signBillingMessage(customerRegistrationMessage(authorized.value, "stripe", created.customerId), signingSecret));
          if (!registered.ok) return registered;
          // Whatever was registered first wins (two tabs): always use what the database holds.
          customerId = registered.value;
        }
        const checkout = await adapter.startCheckout({
          workspaceId: authorized.value, customerId, productKey: planId, productName: deps.productName(planId),
          amountCents: price.amountCents, currency: price.currency, interval,
          successUrl: deps.appUrl(billingReturnPath(authorized.value, "sucesso")), cancelUrl: deps.appUrl(billingReturnPath(authorized.value, "cancelado")),
          idempotencyKey: checkoutIdempotencyKey(authorized.value, planId, interval, now()),
        });
        return { ok: true, value: checkout };
      } catch (error) {
        return { ok: false, error: fromProvider(error) };
      }
    },

    /** Cancels at the end of the paid period. Allowed whatever the billing mode says about new sales. */
    async cancel(workspaceId: unknown): Promise<BillingResult<{ planChanged: boolean; slugs: string[] }>> {
      const authorized = await authorize(workspaceId);
      if (!authorized.ok) return authorized;
      if (!deps.sync) return { ok: false, error: "billing_off" };
      const handle = await repository.beginChange(authorized.value, "cancel", null);
      if (!handle.ok) return handle;
      try {
        await deps.sync.adapter.cancelAtPeriodEnd(handle.value.subscriptionId);
      } catch (error) {
        return { ok: false, error: fromProvider(error) };
      }
      return { ok: true, value: await syncAfterAction(deps.sync, handle.value) };
    },

    async resume(workspaceId: unknown): Promise<BillingResult<{ planChanged: boolean; slugs: string[] }>> {
      const authorized = await authorize(workspaceId);
      if (!authorized.ok) return authorized;
      if (!deps.sync) return { ok: false, error: "billing_off" };
      const handle = await repository.beginChange(authorized.value, "resume", null);
      if (!handle.ok) return handle;
      try {
        await deps.sync.adapter.resume(handle.value.subscriptionId);
      } catch (error) {
        return { ok: false, error: fromProvider(error) };
      }
      return { ok: true, value: await syncAfterAction(deps.sync, handle.value) };
    },

    /**
     * Moves a running subscription to another paid plan, same interval. A more expensive plan
     * applies now and charges the difference; a cheaper one is charged from the next renewal, and
     * the database keeps the plan already paid for until then.
     */
    async changePlan(workspaceId: unknown, planId: unknown): Promise<BillingResult<{ planChanged: boolean; slugs: string[]; effective: "now" | "period_end" }>> {
      const authorized = await authorize(workspaceId);
      if (!authorized.ok) return authorized;
      if (deps.mode === "off" || !deps.sync) return { ok: false, error: "billing_off" };
      if (!isPlanId(planId) || !isPaidPlan(planId)) return { ok: false, error: "invalid_plan" };
      const handle = await repository.beginChange(authorized.value, "change_plan", planId);
      if (!handle.ok) return handle;
      const price = planPrice(planId, handle.value.interval);
      // The database and the code catalogue must agree on the amount (the drift test guards it).
      if (!price || price.amountCents !== handle.value.amountCents || !isPlanId(handle.value.planId)) return { ok: false, error: "unavailable" };
      const effective = planRank(planId) > planRank(handle.value.planId) ? "now" : "period_end";
      try {
        await deps.sync.adapter.changePlan({
          subscriptionId: handle.value.subscriptionId, productKey: planId, productName: deps.productName(planId),
          amountCents: price.amountCents, currency: price.currency, interval: handle.value.interval,
          effective,
          idempotencyKey: `lnk-chg-${deps.newId()}`,
        });
      } catch (error) {
        return { ok: false, error: fromProvider(error) };
      }
      return { ok: true, value: { ...(await syncAfterAction(deps.sync, handle.value)), effective } };
    },

    /** The provider's own page to change the card and download invoices. */
    async openSelfService(workspaceId: unknown): Promise<BillingResult<{ url: string }>> {
      const authorized = await authorize(workspaceId);
      if (!authorized.ok) return authorized;
      if (!deps.sync) return { ok: false, error: "billing_off" };
      const customerId = await repository.findCustomerId(authorized.value);
      if (!customerId) return { ok: false, error: "no_subscription" };
      try {
        const session = await deps.sync.adapter.openSelfService({ customerId, returnUrl: deps.appUrl(billingHomePath(authorized.value)) });
        return session ? { ok: true, value: session } : { ok: false, error: "provider_rejected" };
      } catch (error) {
        return { ok: false, error: fromProvider(error) };
      }
    },
  };
}

export type BillingService = ReturnType<typeof createBillingService>;
