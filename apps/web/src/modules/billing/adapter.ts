import type { BillingCurrency, BillingInterval } from "./catalog";
import type { SubscriptionStatus } from "./subscription";

/**
 * PaymentsAdapter (ADR 0014): everything the product asks of a payment provider, in the product's
 * own terms. No provider type, status name or event name crosses this file. Two implementations:
 * `stripe-adapter.ts` (HTTP, no SDK) and `fake-adapter.ts` (deterministic, in memory, for tests).
 *
 * The adapter never decides what a workspace is entitled to. It reports what the provider says;
 * the database derives the plan from the amount actually charged (plan_prices).
 */
export type PaymentsProvider = "stripe" | "fake";

export interface ProviderInvoice {
  id: string;
  amountCents: number;
  currency: string;
  status: "open" | "paid" | "void" | "uncollectible";
  /** When the provider recorded the payment, if paid. */
  paidAt: Date | null;
  createdAt: Date;
  /** The provider's hosted receipt page. Always https. */
  receiptUrl: string | null;
}

export interface ProviderSubscription {
  id: string;
  customerId: string;
  /** The workspace the subscription was created for, as the provider stored it at checkout. */
  workspaceId: string | null;
  status: SubscriptionStatus;
  amountCents: number;
  currency: string;
  interval: BillingInterval;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface CheckoutRequest {
  workspaceId: string;
  customerId: string;
  /** Stable key of what is sold (the plan id): the provider keeps one product per key. */
  productKey: string;
  /** Shown on the provider's checkout page and on invoices. */
  productName: string;
  /** From the price catalogue, never from the browser. */
  amountCents: number;
  currency: BillingCurrency;
  interval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
  /** Same key, same checkout: a double click or a retry does not open a second one. */
  idempotencyKey: string;
}

export interface PlanChangeRequest {
  subscriptionId: string;
  productKey: string;
  productName: string;
  amountCents: number;
  currency: BillingCurrency;
  interval: BillingInterval;
  /** `now`: charge the difference at once (upgrade). `period_end`: no charge now, the new price applies from the next renewal (downgrade). */
  effective: "now" | "period_end";
  idempotencyKey: string;
}

/** What a verified webhook is about, reduced to what the product needs to look the state up again. */
export type WebhookTopic = "subscription" | "invoice" | "checkout" | "dispute" | "refund" | "other";

export interface ProviderEvent {
  id: string;
  topic: WebhookTopic;
  customerId: string | null;
  subscriptionId: string | null;
  /** Only for disputes: the charge under dispute, to find the customer. */
  chargeId: string | null;
}

export type WebhookVerification =
  | { ok: true; event: ProviderEvent }
  | { ok: false; reason: "missing_signature" | "bad_signature" | "stale_timestamp" | "malformed" };

export type PaymentsFailure = "unavailable" | "rejected" | "not_found" | "not_set_up";

export class PaymentsError extends Error {
  constructor(readonly kind: PaymentsFailure, readonly providerCode: string | null = null) {
    super(`Payment provider call failed: ${kind}`);
    this.name = "PaymentsError";
  }
}

export interface PaymentsAdapter {
  readonly provider: PaymentsProvider;

  /** Creates the provider customer for a workspace. Idempotent per workspace. */
  createCustomer(input: { workspaceId: string; workspaceName: string }): Promise<{ customerId: string }>;
  /** Opens a hosted checkout and returns its address. Card data never touches the product. */
  startCheckout(request: CheckoutRequest): Promise<{ url: string }>;

  fetchSubscription(subscriptionId: string): Promise<ProviderSubscription | null>;
  /** The customer's most recent subscription, whatever its status. */
  findCustomerSubscription(customerId: string): Promise<ProviderSubscription | null>;
  /** Most recent first, bounded. */
  listInvoices(subscriptionId: string, limit: number): Promise<ProviderInvoice[]>;
  /** The customer a charge belongs to (disputes name a charge, not a customer). */
  findChargeCustomer(chargeId: string): Promise<string | null>;

  cancelAtPeriodEnd(subscriptionId: string): Promise<void>;
  resume(subscriptionId: string): Promise<void>;
  changePlan(request: PlanChangeRequest): Promise<void>;
  /** Ends the subscription at once: chargebacks and a second subscription paid by mistake. */
  cancelNow(subscriptionId: string): Promise<void>;

  /** The provider's own page to change the card and see invoices, when it has one. */
  openSelfService(input: { customerId: string; returnUrl: string }): Promise<{ url: string } | null>;

  /** Checks the signature over the raw body before anything is parsed. */
  verifyWebhook(input: { rawBody: string; signatureHeader: string | null; now: Date }): WebhookVerification;
}
