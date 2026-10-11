import { isBillingInterval } from "./catalog";
import { PaymentsError, type PaymentsAdapter, type ProviderEvent, type ProviderInvoice, type ProviderSubscription, type WebhookTopic } from "./adapter";
import type { SubscriptionStatus } from "./subscription";
import { verifyWebhookSignature } from "./webhook-signature";

/**
 * Stripe behind the PaymentsAdapter (ADR 0014). Plain `fetch` against the REST API, no SDK: the
 * surface used is ten calls and one signature check. Nothing outside this file knows a Stripe
 * status, event name or field. Written from the official documentation (pages and date in the ADR);
 * run against a real Stripe sandbox for the first time on 2026-10-10 (checkout, subscription,
 * upgrade, portal, cancel and resume matched). Failing payments, disputes and refunds are still
 * covered only by the contract test (documentation-shaped responses) and the local emulator in
 * scripts/billing-lifecycle.mjs.
 */
export const STRIPE_API_VERSION = "2026-09-30.endive";
const STRIPE_API_ORIGIN = "https://api.stripe.com";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_WEBHOOK_BYTES = 256 * 1024;

export interface StripeAdapterConfig {
  secretKey: string;
  webhookSecret: string;
  /** Loopback emulator in sandbox only (modules/billing/mode.ts enforces it). */
  apiBaseUrl?: string | null;
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;
type Params = { [key: string]: string | number | boolean | Params | Params[] };

/** `a[b]=1&c[0][d]=2`: the form encoding Stripe's API takes. */
export function encodeStripeForm(params: Params, prefix = ""): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((item, index) => parts.push(encodeStripeForm(item, `${name}[${index}]`)));
    else if (typeof value === "object") parts.push(encodeStripeForm(value, name));
    else parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return parts.filter(Boolean).join("&");
}

function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Stripe references are an id or, when expanded, an object with an id. */
function reference(value: unknown): string | null {
  return text(value) ?? text(object(value)?.id);
}

function instant(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Stripe's eight statuses reduced to the product's four (ADR 0014):
 *   trialing is treated as paid (the product offers no trial; it cannot be produced by our checkout);
 *   unpaid and paused stay "payment missing", so the grace clock, not Stripe's retry schedule, decides;
 *   incomplete_expired and canceled are the end.
 */
const STATUS: Record<string, SubscriptionStatus> = {
  incomplete: "incomplete",
  incomplete_expired: "ended",
  trialing: "active",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  paused: "past_due",
  canceled: "ended",
};

export function mapStripeSubscription(raw: unknown): ProviderSubscription | null {
  const subscription = object(raw);
  const id = text(subscription?.id);
  const customerId = reference(subscription?.customer);
  const status = STATUS[String(subscription?.status)];
  const item = object((object(subscription?.items)?.data as unknown[] | undefined)?.[0]);
  const price = object(item?.price);
  const interval = object(price?.recurring)?.interval;
  const amountCents = price?.unit_amount;
  const currency = text(price?.currency);
  if (!subscription || !id || !customerId || !status || !isBillingInterval(interval) || typeof amountCents !== "number" || !Number.isInteger(amountCents) || !currency) return null;
  const workspaceId = text(object(subscription.metadata)?.workspace_id);
  return {
    id,
    customerId,
    workspaceId: workspaceId && UUID.test(workspaceId) ? workspaceId : null,
    status,
    amountCents,
    currency: currency.toUpperCase(),
    interval,
    // Recent API versions carry the period on the item; older ones on the subscription.
    currentPeriodEnd: instant(item?.current_period_end) ?? instant(subscription.current_period_end),
    // The customer portal schedules a cancellation with `cancel_at`; the API flag is `cancel_at_period_end`.
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true || typeof subscription.cancel_at === "number",
  };
}

const INVOICE_STATUSES = ["open", "paid", "void", "uncollectible"] as const;

export function mapStripeInvoice(raw: unknown): ProviderInvoice | null {
  const invoice = object(raw);
  const id = text(invoice?.id);
  const status = INVOICE_STATUSES.find((value) => value === invoice?.status);
  const createdAt = instant(invoice?.created);
  const currency = text(invoice?.currency);
  // Drafts are not shown: they are not charges yet.
  if (!invoice || !id || !status || !createdAt || !currency) return null;
  const amount = status === "paid" ? invoice.amount_paid : invoice.amount_due;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) return null;
  const receiptUrl = text(invoice.hosted_invoice_url);
  return {
    id,
    amountCents: amount,
    currency: currency.toUpperCase(),
    status,
    paidAt: status === "paid" ? instant(object(invoice.status_transitions)?.paid_at) : null,
    createdAt,
    receiptUrl: receiptUrl && receiptUrl.startsWith("https://") && receiptUrl.length <= 2048 ? receiptUrl : null,
  };
}

function topicOf(type: string): WebhookTopic {
  if (type.startsWith("customer.subscription.")) return "subscription";
  if (type.startsWith("invoice.")) return "invoice";
  if (type.startsWith("checkout.session.")) return "checkout";
  if (type.startsWith("charge.dispute.")) return "dispute";
  if (type === "charge.refunded" || type.startsWith("refund.")) return "refund";
  return "other";
}

/** A verified event reduced to what is needed to read the state again. The payload's own state is not used. */
export function mapStripeEvent(raw: unknown): ProviderEvent | null {
  const event = object(raw);
  const id = text(event?.id);
  const type = text(event?.type);
  const subject = object(object(event?.data)?.object);
  if (!event || !id || !type || !subject || id.length > 255) return null;
  const topic = topicOf(type);
  switch (topic) {
    case "subscription":
      return { id, topic, customerId: reference(subject.customer), subscriptionId: text(subject.id), chargeId: null };
    case "invoice":
      return {
        id, topic, customerId: reference(subject.customer), chargeId: null,
        subscriptionId: reference(subject.subscription) ?? reference(object(object(subject.parent)?.subscription_details)?.subscription),
      };
    case "checkout":
      return { id, topic, customerId: reference(subject.customer), subscriptionId: reference(subject.subscription), chargeId: null };
    case "dispute":
      return { id, topic, customerId: null, subscriptionId: null, chargeId: reference(subject.charge) };
    case "refund":
      return { id, topic, customerId: reference(subject.customer), subscriptionId: null, chargeId: reference(subject.charge) ?? text(subject.id) };
    case "other":
      return { id, topic, customerId: null, subscriptionId: null, chargeId: null };
  }
}

export function createStripeAdapter(config: StripeAdapterConfig): PaymentsAdapter {
  const origin = (config.apiBaseUrl ?? STRIPE_API_ORIGIN).replace(/\/+$/, "");
  const doFetch = config.fetch ?? fetch;

  async function call(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}, idempotencyKey?: string): Promise<Json> {
    const form = encodeStripeForm(params);
    const url = `${origin}${path}${method === "GET" && form ? `?${form}` : ""}`;
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          "Stripe-Version": STRIPE_API_VERSION,
          ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: method === "POST" ? form : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new PaymentsError("unavailable");
    }
    let body: Json | null = null;
    try {
      body = object(await response.json());
    } catch {
      body = null;
    }
    if (response.ok && body) return body;
    // Only Stripe's machine-readable code leaves this function: never the message, which can quote input.
    const code = text(object(body?.error)?.code);
    if (response.status === 404) throw new PaymentsError("not_found", code);
    if (response.status === 429 || response.status >= 500 || !body) throw new PaymentsError("unavailable", code);
    throw new PaymentsError("rejected", code);
  }

  async function orNull<T>(work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof PaymentsError && error.kind === "not_found") return null;
      throw error;
    }
  }

  /** Hosted pages are https; the only exception is the loopback emulator this adapter was pointed at. */
  function hostedUrl(value: unknown): string {
    const url = text(value);
    if (url && (url.startsWith("https://") || (config.apiBaseUrl && url.startsWith(`${origin}/`)))) return url;
    throw new PaymentsError("rejected");
  }

  /** One product per plan, with an id the product chooses, so prices can be built inline from the catalogue. */
  async function ensureProduct(productKey: string, name: string): Promise<string> {
    const id = `lnk_plan_${productKey}`;
    try {
      await call("POST", "/v1/products", { id, name });
    } catch (error) {
      if (!(error instanceof PaymentsError) || error.providerCode !== "resource_already_exists") throw error;
    }
    return id;
  }

  function priceData(product: string, amountCents: number, currency: string, interval: string): Params {
    return { currency: currency.toLowerCase(), product, unit_amount: amountCents, recurring: { interval } };
  }

  return {
    provider: "stripe",

    async createCustomer({ workspaceId, workspaceName }) {
      const customer = await call("POST", "/v1/customers", { name: workspaceName.slice(0, 120), metadata: { workspace_id: workspaceId } }, `lnk-customer-${workspaceId}`);
      const customerId = text(customer.id);
      if (!customerId) throw new PaymentsError("rejected");
      return { customerId };
    },

    async startCheckout(request) {
      const product = await ensureProduct(request.productKey, request.productName);
      const session = await call("POST", "/v1/checkout/sessions", {
        mode: "subscription",
        customer: request.customerId,
        client_reference_id: request.workspaceId,
        locale: "pt-BR",
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        line_items: [{ quantity: 1, price_data: priceData(product, request.amountCents, request.currency, request.interval) }],
        metadata: { workspace_id: request.workspaceId },
        subscription_data: { metadata: { workspace_id: request.workspaceId } },
      }, request.idempotencyKey);
      return { url: hostedUrl(session.url) };
    },

    async fetchSubscription(subscriptionId) {
      const raw = await orNull(() => call("GET", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`));
      return raw ? mapStripeSubscription(raw) : null;
    },

    async findCustomerSubscription(customerId) {
      const list = await call("GET", "/v1/subscriptions", { customer: customerId, status: "all", limit: 1 });
      const first = (list.data as unknown[] | undefined)?.[0];
      return first ? mapStripeSubscription(first) : null;
    },

    async listInvoices(subscriptionId, limit) {
      const list = await call("GET", "/v1/invoices", { subscription: subscriptionId, limit: Math.min(Math.max(limit, 1), 100) });
      return ((list.data as unknown[] | undefined) ?? []).map(mapStripeInvoice).filter((invoice): invoice is ProviderInvoice => invoice !== null);
    },

    async findChargeCustomer(chargeId) {
      const charge = await orNull(() => call("GET", `/v1/charges/${encodeURIComponent(chargeId)}`));
      return charge ? reference(charge.customer) : null;
    },

    async cancelAtPeriodEnd(subscriptionId) {
      await call("POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: true });
    },

    async resume(subscriptionId) {
      await call("POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: false });
    },

    async changePlan(request) {
      const current = await call("GET", `/v1/subscriptions/${encodeURIComponent(request.subscriptionId)}`);
      const itemId = text(object((object(current.items)?.data as unknown[] | undefined)?.[0])?.id);
      if (!itemId) throw new PaymentsError("rejected");
      const product = await ensureProduct(request.productKey, request.productName);
      await call("POST", `/v1/subscriptions/${encodeURIComponent(request.subscriptionId)}`, {
        items: [{ id: itemId, price_data: priceData(product, request.amountCents, request.currency, request.interval) }],
        // Upgrade: charge the difference now. Downgrade: no credit and no charge; the new price starts at the next renewal.
        proration_behavior: request.effective === "now" ? "always_invoice" : "none",
      }, request.idempotencyKey);
    },

    async cancelNow(subscriptionId) {
      await orNull(() => call("DELETE", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`));
    },

    async openSelfService({ customerId, returnUrl }) {
      const session = await call("POST", "/v1/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
      return { url: hostedUrl(session.url) };
    },

    verifyWebhook({ rawBody, signatureHeader, now }) {
      // Signature first, over the raw body; nothing is parsed before it holds.
      const failure = verifyWebhookSignature(rawBody, signatureHeader, config.webhookSecret, now);
      if (failure) return { ok: false, reason: failure };
      if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) return { ok: false, reason: "malformed" };
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return { ok: false, reason: "malformed" };
      }
      const event = mapStripeEvent(parsed);
      return event ? { ok: true, event } : { ok: false, reason: "malformed" };
    },
  };
}
