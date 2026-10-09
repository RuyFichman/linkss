import { PaymentsError, type PaymentsAdapter, type ProviderEvent, type ProviderInvoice, type ProviderSubscription, type WebhookTopic } from "./adapter";
import type { BillingInterval } from "./catalog";
import type { SubscriptionStatus } from "./subscription";
import { signWebhookPayload, verifyWebhookSignature } from "./webhook-signature";

/**
 * Deterministic in-memory payment provider for tests (ADR 0014). It implements the same
 * PaymentsAdapter as Stripe and adds the provider's side of the story as plain methods (a customer
 * pays, a card fails, a period ends), so a test can drive a whole life cycle with an injected clock.
 * It is never constructed by application code: the local stack runs the real adapter against the
 * emulator in scripts/billing-lifecycle.mjs.
 */
export const FAKE_WEBHOOK_SECRET = "whsec_fake_adapter_secret_0000000000";
const DAY_MS = 24 * 60 * 60 * 1000;

interface FakeSubscription extends ProviderSubscription {
  invoices: ProviderInvoice[];
}

interface FakeCheckout {
  id: string;
  workspaceId: string;
  customerId: string;
  amountCents: number;
  currency: string;
  interval: BillingInterval;
}

export interface FakeDelivery {
  rawBody: string;
  signatureHeader: string;
  event: ProviderEvent;
}

export function createFakePaymentsAdapter(clock: () => Date) {
  let sequence = 0;
  const next = (prefix: string) => `${prefix}_fake_${String(++sequence).padStart(4, "0")}`;
  const customers = new Map<string, { id: string; workspaceId: string }>();
  const customersByKey = new Map<string, string>();
  const checkouts = new Map<string, FakeCheckout>();
  const checkoutsByKey = new Map<string, string>();
  const subscriptions = new Map<string, FakeSubscription>();
  const charges = new Map<string, string>();
  const calls: string[] = [];
  let down = false;

  function guard(name: string): void {
    calls.push(name);
    if (down) throw new PaymentsError("unavailable");
  }

  function periodEnd(from: Date, interval: BillingInterval): Date {
    return new Date(from.getTime() + (interval === "year" ? 365 : 30) * DAY_MS);
  }

  function publicView(subscription: FakeSubscription): ProviderSubscription {
    return {
      id: subscription.id, customerId: subscription.customerId, workspaceId: subscription.workspaceId, status: subscription.status, amountCents: subscription.amountCents,
      currency: subscription.currency, interval: subscription.interval, currentPeriodEnd: subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    };
  }

  function need(subscriptionId: string): FakeSubscription {
    const subscription = subscriptions.get(subscriptionId);
    if (!subscription) throw new PaymentsError("not_found");
    return subscription;
  }

  function invoice(subscription: FakeSubscription, status: ProviderInvoice["status"], amountCents = subscription.amountCents): ProviderInvoice {
    const id = next("in");
    const created: ProviderInvoice = { id, amountCents, currency: subscription.currency, status, paidAt: status === "paid" ? clock() : null, createdAt: clock(), receiptUrl: `https://pay.fake.test/${id}` };
    subscription.invoices.unshift(created);
    if (status === "paid") charges.set(`ch_${id}`, subscription.customerId);
    return created;
  }

  /** A signed delivery, as the provider would send it. Each call is a new event unless `id` is given. */
  function deliver(topic: WebhookTopic, subject: { customerId?: string | null; subscriptionId?: string | null; chargeId?: string | null }, options: { id?: string; secret?: string; signedAt?: Date } = {}): FakeDelivery {
    const event: ProviderEvent = { id: options.id ?? next("evt"), topic, customerId: subject.customerId ?? null, subscriptionId: subject.subscriptionId ?? null, chargeId: subject.chargeId ?? null };
    const rawBody = JSON.stringify(event);
    return { rawBody, signatureHeader: signWebhookPayload(rawBody, options.secret ?? FAKE_WEBHOOK_SECRET, options.signedAt ?? clock()), event };
  }

  const adapter: PaymentsAdapter = {
    provider: "fake",

    async createCustomer({ workspaceId }) {
      guard("createCustomer");
      const existing = customersByKey.get(workspaceId);
      if (existing) return { customerId: existing };
      const id = next("cus");
      customers.set(id, { id, workspaceId });
      customersByKey.set(workspaceId, id);
      return { customerId: id };
    },

    async startCheckout(request) {
      guard("startCheckout");
      if (!customers.has(request.customerId)) throw new PaymentsError("rejected");
      const existing = checkoutsByKey.get(request.idempotencyKey);
      const id = existing ?? next("cs");
      if (!existing) {
        checkouts.set(id, { id, workspaceId: request.workspaceId, customerId: request.customerId, amountCents: request.amountCents, currency: request.currency, interval: request.interval });
        checkoutsByKey.set(request.idempotencyKey, id);
      }
      return { url: `https://pay.fake.test/checkout/${id}` };
    },

    async fetchSubscription(subscriptionId) {
      guard("fetchSubscription");
      const subscription = subscriptions.get(subscriptionId);
      return subscription ? publicView(subscription) : null;
    },

    async findCustomerSubscription(customerId) {
      guard("findCustomerSubscription");
      const owned = [...subscriptions.values()].filter((subscription) => subscription.customerId === customerId);
      const latest = owned.at(-1);
      return latest ? publicView(latest) : null;
    },

    async listInvoices(subscriptionId, limit) {
      guard("listInvoices");
      return need(subscriptionId).invoices.slice(0, limit).map((item) => ({ ...item }));
    },

    async findChargeCustomer(chargeId) {
      guard("findChargeCustomer");
      return charges.get(chargeId) ?? null;
    },

    async cancelAtPeriodEnd(subscriptionId) {
      guard("cancelAtPeriodEnd");
      need(subscriptionId).cancelAtPeriodEnd = true;
    },

    async resume(subscriptionId) {
      guard("resume");
      need(subscriptionId).cancelAtPeriodEnd = false;
    },

    async changePlan(request) {
      guard("changePlan");
      const subscription = need(request.subscriptionId);
      if (request.effective === "now" && request.amountCents > subscription.amountCents) invoice(subscription, "paid", request.amountCents - subscription.amountCents);
      subscription.amountCents = request.amountCents;
      subscription.interval = request.interval;
    },

    async cancelNow(subscriptionId) {
      guard("cancelNow");
      const subscription = subscriptions.get(subscriptionId);
      if (subscription) subscription.status = "ended";
    },

    async openSelfService({ customerId }) {
      guard("openSelfService");
      return customers.has(customerId) ? { url: `https://pay.fake.test/portal/${customerId}` } : null;
    },

    verifyWebhook({ rawBody, signatureHeader, now }) {
      const failure = verifyWebhookSignature(rawBody, signatureHeader, FAKE_WEBHOOK_SECRET, now);
      if (failure) return { ok: false, reason: failure };
      try {
        const event = JSON.parse(rawBody) as ProviderEvent;
        return typeof event.id === "string" && typeof event.topic === "string" ? { ok: true, event } : { ok: false, reason: "malformed" };
      } catch {
        return { ok: false, reason: "malformed" };
      }
    },
  };

  return {
    adapter,
    calls,
    deliver,
    /** The provider stops answering. */
    setDown(value: boolean): void {
      down = value;
    },
    checkoutIdFromUrl(url: string): string {
      return url.slice(url.lastIndexOf("/") + 1);
    },

    /** The customer completes the hosted checkout. `paid: false` leaves the first payment pending. */
    completeCheckout(checkoutId: string, options: { paid?: boolean } = {}): FakeDelivery {
      const checkout = checkouts.get(checkoutId);
      if (!checkout) throw new Error(`Unknown fake checkout: ${checkoutId}`);
      const paid = options.paid ?? true;
      const subscription: FakeSubscription = {
        id: next("sub"), customerId: checkout.customerId, workspaceId: checkout.workspaceId, status: paid ? "active" : "incomplete",
        amountCents: checkout.amountCents, currency: checkout.currency, interval: checkout.interval,
        currentPeriodEnd: periodEnd(clock(), checkout.interval), cancelAtPeriodEnd: false, invoices: [],
      };
      subscriptions.set(subscription.id, subscription);
      invoice(subscription, paid ? "paid" : "open");
      return deliver("checkout", { customerId: subscription.customerId, subscriptionId: subscription.id });
    },

    /** The period ends: a cancelled subscription ends, a paying one renews (or its charge fails). */
    endPeriod(subscriptionId: string, options: { paymentFails?: boolean } = {}): FakeDelivery {
      const subscription = need(subscriptionId);
      if (subscription.cancelAtPeriodEnd) {
        subscription.status = "ended";
        return deliver("subscription", { customerId: subscription.customerId, subscriptionId });
      }
      if (options.paymentFails) {
        subscription.status = "past_due";
        invoice(subscription, "open");
      } else {
        subscription.status = "active";
        invoice(subscription, "paid");
      }
      subscription.currentPeriodEnd = periodEnd(subscription.currentPeriodEnd ?? clock(), subscription.interval);
      return deliver("invoice", { customerId: subscription.customerId, subscriptionId });
    },

    /** The open invoice is paid (the customer fixed the card, or a retry worked). */
    recover(subscriptionId: string): FakeDelivery {
      const subscription = need(subscriptionId);
      const open = subscription.invoices.find((item) => item.status === "open");
      if (open) Object.assign(open, { status: "paid", paidAt: clock() });
      subscription.status = "active";
      return deliver("invoice", { customerId: subscription.customerId, subscriptionId });
    },

    /** The provider gives up, or somebody deletes the subscription in the provider's dashboard. */
    end(subscriptionId: string): FakeDelivery {
      const subscription = need(subscriptionId);
      subscription.status = "ended";
      return deliver("subscription", { customerId: subscription.customerId, subscriptionId });
    },

    /** The cardholder disputes the latest paid charge. */
    dispute(subscriptionId: string): FakeDelivery {
      const subscription = need(subscriptionId);
      const paid = subscription.invoices.find((item) => item.status === "paid");
      if (!paid) throw new Error("Nothing to dispute");
      return deliver("dispute", { chargeId: `ch_${paid.id}` });
    },

    setStatus(subscriptionId: string, status: SubscriptionStatus): void {
      need(subscriptionId).status = status;
    },
    setAmount(subscriptionId: string, amountCents: number): void {
      need(subscriptionId).amountCents = amountCents;
    },
    subscription(subscriptionId: string): ProviderSubscription {
      return publicView(need(subscriptionId));
    },
    subscriptionIds(): string[] {
      return [...subscriptions.keys()];
    },
  };
}

export type FakePaymentsProvider = ReturnType<typeof createFakePaymentsAdapter>;
