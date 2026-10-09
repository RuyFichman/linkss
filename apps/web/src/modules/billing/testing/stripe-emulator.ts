// Local emulator of the part of Stripe's REST API the adapter uses (ADR 0014). It exists because a
// provider sandbox cannot call localhost and no Stripe account exists yet: the contract test runs
// the real adapter against it, and scripts/billing-lifecycle.mjs serves it over HTTP so the local
// stack runs the real adapter, the real webhook route and the real database end to end.
//
// It is written from Stripe's public documentation (object shapes, status names, error codes,
// webhook signature), not recorded from Stripe. It proves the adapter and the product agree with
// that reading; it does not prove Stripe behaves this way. Never imported by application code.
//
// Kept free of local imports and of non-erasable TypeScript so Node can load it directly.
import { createHmac } from "node:crypto";

export interface EmulatorDelivery {
  eventId: string;
  type: string;
  rawBody: string;
  signatureHeader: string;
}

export interface EmulatorRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: URLSearchParams;
  authorization: string | null;
  idempotencyKey: string | null;
}

export interface EmulatorResponse {
  status: number;
  json: Record<string, unknown>;
}

interface Invoice {
  id: string;
  subscription: string;
  customer: string;
  status: "open" | "paid" | "void" | "uncollectible";
  amount: number;
  currency: string;
  created: number;
  paidAt: number | null;
  charge: string | null;
}

interface Subscription {
  id: string;
  customer: string;
  status: "incomplete" | "incomplete_expired" | "active" | "past_due" | "canceled";
  cancelAtPeriodEnd: boolean;
  workspaceId: string;
  itemId: string;
  product: string;
  amount: number;
  currency: string;
  interval: "month" | "year";
  periodEnd: number;
  created: number;
}

interface Session {
  id: string;
  customer: string;
  workspaceId: string;
  product: string;
  amount: number;
  currency: string;
  interval: "month" | "year";
  successUrl: string;
  cancelUrl: string;
  subscription: string | null;
}

const DAY = 24 * 60 * 60;

export function createStripeEmulator(options: { webhookSecret: string; now: () => Date; origin: string; runId?: string }) {
  const runId = options.runId ?? "";
  let sequence = 0;
  const next = (prefix: string) => `${prefix}_emu${runId}${String(++sequence).padStart(5, "0")}`;
  const seconds = () => Math.floor(options.now().getTime() / 1000);

  const products = new Map<string, string>();
  const customers = new Map<string, { id: string; name: string; workspaceId: string }>();
  const sessions = new Map<string, Session>();
  const subscriptions = new Map<string, Subscription>();
  const invoices: Invoice[] = [];
  const charges = new Map<string, string>();
  const replies = new Map<string, EmulatorResponse>();
  const requests: Array<{ method: string; path: string; body: Record<string, string> }> = [];

  const error = (status: number, code: string): EmulatorResponse => ({ status, json: { error: { type: "invalid_request_error", code, message: `emulator: ${code}` } } });

  function subscriptionJson(subscription: Subscription): Record<string, unknown> {
    return {
      id: subscription.id, object: "subscription", customer: subscription.customer, status: subscription.status,
      cancel_at_period_end: subscription.cancelAtPeriodEnd, cancel_at: null, created: subscription.created,
      currency: subscription.currency, metadata: { workspace_id: subscription.workspaceId },
      items: {
        object: "list",
        data: [{
          id: subscription.itemId, object: "subscription_item", current_period_end: subscription.periodEnd, quantity: 1,
          price: { id: `price_${subscription.itemId}`, object: "price", currency: subscription.currency, unit_amount: subscription.amount, product: subscription.product, recurring: { interval: subscription.interval, interval_count: 1 }, type: "recurring" },
        }],
      },
    };
  }

  function invoiceJson(invoice: Invoice): Record<string, unknown> {
    return {
      id: invoice.id, object: "invoice", customer: invoice.customer, status: invoice.status, currency: invoice.currency, created: invoice.created,
      amount_due: invoice.amount, amount_paid: invoice.status === "paid" ? invoice.amount : 0,
      hosted_invoice_url: `https://invoice.stripe.example.test/${invoice.id}`,
      status_transitions: { paid_at: invoice.paidAt },
      parent: { type: "subscription_details", subscription_details: { subscription: invoice.subscription } },
    };
  }

  function addInvoice(subscription: Subscription, status: Invoice["status"], amount = subscription.amount): Invoice {
    const id = next("in");
    const charge = status === "paid" ? next("ch") : null;
    const invoice: Invoice = { id, subscription: subscription.id, customer: subscription.customer, status, amount, currency: subscription.currency, created: seconds(), paidAt: status === "paid" ? seconds() : null, charge };
    invoices.unshift(invoice);
    if (charge) charges.set(charge, subscription.customer);
    return invoice;
  }

  function periodEndFrom(from: number, interval: "month" | "year"): number {
    return from + (interval === "year" ? 365 : 30) * DAY;
  }

  /** Stripe's header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
  function sign(rawBody: string, at: Date = options.now(), secret: string = options.webhookSecret): string {
    const timestamp = String(Math.floor(at.getTime() / 1000));
    return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;
  }

  function event(type: string, object: Record<string, unknown>): EmulatorDelivery {
    const eventId = next("evt");
    const rawBody = JSON.stringify({ id: eventId, object: "event", api_version: "2026-09-30.endive", created: seconds(), type, livemode: false, data: { object } });
    return { eventId, type, rawBody, signatureHeader: sign(rawBody) };
  }

  function need(subscriptionId: string): Subscription {
    const subscription = subscriptions.get(subscriptionId);
    if (!subscription) throw new Error(`emulator: unknown subscription ${subscriptionId}`);
    return subscription;
  }

  function route(request: EmulatorRequest): EmulatorResponse {
    const { method, path, query, body } = request;
    const subscriptionMatch = /^\/v1\/subscriptions\/([A-Za-z0-9_]+)$/.exec(path);
    const chargeMatch = /^\/v1\/charges\/([A-Za-z0-9_]+)$/.exec(path);

    if (method === "POST" && path === "/v1/products") {
      const id = body.get("id") ?? next("prod");
      if (products.has(id)) return error(400, "resource_already_exists");
      products.set(id, body.get("name") ?? "");
      return { status: 200, json: { id, object: "product", name: products.get(id) } };
    }
    if (method === "POST" && path === "/v1/customers") {
      const id = next("cus");
      customers.set(id, { id, name: body.get("name") ?? "", workspaceId: body.get("metadata[workspace_id]") ?? "" });
      return { status: 200, json: { id, object: "customer", name: body.get("name"), metadata: { workspace_id: body.get("metadata[workspace_id]") } } };
    }
    if (method === "POST" && path === "/v1/checkout/sessions") {
      const customer = body.get("customer") ?? "";
      const product = body.get("line_items[0][price_data][product]") ?? "";
      const amount = Number(body.get("line_items[0][price_data][unit_amount]"));
      const interval = body.get("line_items[0][price_data][recurring][interval]");
      if (body.get("mode") !== "subscription") return error(400, "parameter_invalid_string_empty");
      if (!customers.has(customer)) return error(400, "resource_missing");
      if (!products.has(product)) return error(400, "resource_missing");
      if (!Number.isInteger(amount) || amount <= 0 || (interval !== "month" && interval !== "year")) return error(400, "parameter_invalid_integer");
      const id = next("cs_test");
      sessions.set(id, {
        id, customer, product, amount, interval, currency: (body.get("line_items[0][price_data][currency]") ?? "").toLowerCase(),
        workspaceId: body.get("subscription_data[metadata][workspace_id]") ?? "", successUrl: body.get("success_url") ?? "", cancelUrl: body.get("cancel_url") ?? "", subscription: null,
      });
      return { status: 200, json: { id, object: "checkout.session", mode: "subscription", customer, url: `${options.origin}/emulator/checkout/${id}`, client_reference_id: body.get("client_reference_id") } };
    }
    if (method === "GET" && path === "/v1/subscriptions") {
      const owned = [...subscriptions.values()].filter((subscription) => subscription.customer === query.get("customer")).reverse();
      return { status: 200, json: { object: "list", has_more: false, data: owned.slice(0, Number(query.get("limit") ?? "10")).map(subscriptionJson) } };
    }
    if (subscriptionMatch) {
      const subscription = subscriptions.get(subscriptionMatch[1] ?? "");
      if (!subscription) return error(404, "resource_missing");
      if (method === "POST") {
        if (subscription.status === "canceled" || subscription.status === "incomplete_expired") return error(400, "subscription_canceled");
        if (body.has("cancel_at_period_end")) subscription.cancelAtPeriodEnd = body.get("cancel_at_period_end") === "true";
        if (body.has("items[0][price_data][unit_amount]")) {
          if (body.get("items[0][id]") !== subscription.itemId) return error(400, "resource_missing");
          const product = body.get("items[0][price_data][product]") ?? "";
          if (!products.has(product)) return error(400, "resource_missing");
          const amount = Number(body.get("items[0][price_data][unit_amount]"));
          if (body.get("proration_behavior") === "always_invoice" && amount > subscription.amount) addInvoice(subscription, "paid", amount - subscription.amount);
          subscription.amount = amount;
          subscription.product = product;
        }
      } else if (method === "DELETE") {
        subscription.status = "canceled";
      }
      return { status: 200, json: subscriptionJson(subscription) };
    }
    if (method === "GET" && path === "/v1/invoices") {
      const owned = invoices.filter((invoice) => invoice.subscription === query.get("subscription"));
      return { status: 200, json: { object: "list", has_more: false, data: owned.slice(0, Number(query.get("limit") ?? "10")).map(invoiceJson) } };
    }
    if (method === "GET" && chargeMatch) {
      const customer = charges.get(chargeMatch[1] ?? "");
      return customer ? { status: 200, json: { id: chargeMatch[1], object: "charge", customer } } : error(404, "resource_missing");
    }
    if (method === "POST" && path === "/v1/billing_portal/sessions") {
      const customer = body.get("customer") ?? "";
      if (!customers.has(customer)) return error(400, "resource_missing");
      return { status: 200, json: { id: next("bps"), object: "billing_portal.session", customer, url: `${options.origin}/emulator/portal/${customer}?return=${encodeURIComponent(body.get("return_url") ?? "")}` } };
    }
    return error(404, "url_invalid");
  }

  function handle(request: EmulatorRequest): EmulatorResponse {
    requests.push({ method: request.method, path: request.path, body: Object.fromEntries(request.body) });
    if (!/^Bearer (sk|rk)_test_[A-Za-z0-9_]+$/.test(request.authorization ?? "")) return error(401, "api_key_invalid");
    // Same idempotency key, same answer, nothing done twice.
    if (request.method === "POST" && request.idempotencyKey) {
      const key = `${request.path}:${request.idempotencyKey}`;
      const known = replies.get(key);
      if (known) return known;
      const response = route(request);
      if (response.status === 200) replies.set(key, response);
      return response;
    }
    return route(request);
  }

  return {
    handle,
    sign,
    requests,

    /** `fetch` for the adapter in tests: the same handler, without a socket. */
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
      const headers = new Headers(init?.headers);
      const response = handle({
        method: init?.method ?? "GET", path: url.pathname, query: url.searchParams, body: new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
        authorization: headers.get("authorization"), idempotencyKey: headers.get("idempotency-key"),
      });
      return new Response(JSON.stringify(response.json), { status: response.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch,

    session(sessionId: string): Session | null {
      return sessions.get(sessionId) ?? null;
    },
    sessionIdFromUrl(url: string): string {
      return url.slice(url.lastIndexOf("/") + 1);
    },
    subscriptionStatus(subscriptionId: string): string {
      return need(subscriptionId).status;
    },

    /** The customer pays on the hosted page (or the first payment is left pending). */
    completeCheckout(sessionId: string, input: { paid?: boolean } = {}): { subscriptionId: string; deliveries: EmulatorDelivery[] } {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`emulator: unknown checkout session ${sessionId}`);
      const paid = input.paid ?? true;
      const subscription: Subscription = {
        id: next("sub"), customer: session.customer, status: paid ? "active" : "incomplete", cancelAtPeriodEnd: false, workspaceId: session.workspaceId,
        itemId: next("si"), product: session.product, amount: session.amount, currency: session.currency, interval: session.interval,
        periodEnd: periodEndFrom(seconds(), session.interval), created: seconds(),
      };
      subscriptions.set(subscription.id, subscription);
      session.subscription = subscription.id;
      const invoice = addInvoice(subscription, paid ? "paid" : "open");
      return {
        subscriptionId: subscription.id,
        deliveries: [
          event("checkout.session.completed", { id: session.id, object: "checkout.session", customer: session.customer, subscription: subscription.id, mode: "subscription" }),
          event("customer.subscription.created", subscriptionJson(subscription)),
          event(paid ? "invoice.paid" : "invoice.payment_failed", invoiceJson(invoice)),
        ],
      };
    },

    /** The first payment never arrives: Stripe expires the subscription after 23 hours. */
    expireIncomplete(subscriptionId: string): EmulatorDelivery[] {
      const subscription = need(subscriptionId);
      subscription.status = "incomplete_expired";
      return [event("customer.subscription.updated", subscriptionJson(subscription))];
    },

    /** The period ends: a cancelled subscription is deleted, a paying one renews or its charge fails. */
    endPeriod(subscriptionId: string, input: { paymentFails?: boolean } = {}): EmulatorDelivery[] {
      const subscription = need(subscriptionId);
      if (subscription.cancelAtPeriodEnd) {
        subscription.status = "canceled";
        return [event("customer.subscription.deleted", subscriptionJson(subscription))];
      }
      const invoice = addInvoice(subscription, input.paymentFails ? "open" : "paid");
      subscription.status = input.paymentFails ? "past_due" : "active";
      subscription.periodEnd = periodEndFrom(subscription.periodEnd, subscription.interval);
      return [event(input.paymentFails ? "invoice.payment_failed" : "invoice.paid", invoiceJson(invoice)), event("customer.subscription.updated", subscriptionJson(subscription))];
    },

    /** The open invoice is paid: the customer fixed the card, or a retry worked. */
    recover(subscriptionId: string): EmulatorDelivery[] {
      const subscription = need(subscriptionId);
      const open = invoices.find((invoice) => invoice.subscription === subscriptionId && invoice.status === "open");
      if (open) {
        open.status = "paid";
        open.paidAt = seconds();
        open.charge = next("ch");
        charges.set(open.charge, subscription.customer);
      }
      subscription.status = "active";
      return [...(open ? [event("invoice.paid", invoiceJson(open))] : []), event("customer.subscription.updated", subscriptionJson(subscription))];
    },

    /** Retries are exhausted, or somebody deletes the subscription in the dashboard. */
    deleteSubscription(subscriptionId: string): EmulatorDelivery[] {
      const subscription = need(subscriptionId);
      subscription.status = "canceled";
      return [event("customer.subscription.deleted", subscriptionJson(subscription))];
    },

    /** The cardholder disputes the latest paid charge (a chargeback). Stripe does not cancel by itself. */
    dispute(subscriptionId: string): EmulatorDelivery[] {
      const paid = invoices.find((invoice) => invoice.subscription === subscriptionId && invoice.status === "paid" && invoice.charge);
      if (!paid) throw new Error("emulator: nothing to dispute");
      return [event("charge.dispute.created", { id: next("dp"), object: "dispute", charge: paid.charge, amount: paid.amount, currency: paid.currency, status: "needs_response" })];
    },

    /** The merchant refunds the latest paid charge. The subscription is not touched. */
    refund(subscriptionId: string): EmulatorDelivery[] {
      const subscription = need(subscriptionId);
      const paid = invoices.find((invoice) => invoice.subscription === subscriptionId && invoice.status === "paid" && invoice.charge);
      if (!paid) throw new Error("emulator: nothing to refund");
      return [event("charge.refunded", { id: paid.charge, object: "charge", customer: subscription.customer, amount: paid.amount, amount_refunded: paid.amount, refunded: true })];
    },

    /** An update event for the subscription as it is now (after an API call changed it). */
    updated(subscriptionId: string): EmulatorDelivery[] {
      return [event("customer.subscription.updated", subscriptionJson(need(subscriptionId)))];
    },

    /** An event of a type the product does not listen to. */
    unrelated(): EmulatorDelivery {
      return event("product.updated", { id: "prod_other", object: "product" });
    },
  };
}

export type StripeEmulator = ReturnType<typeof createStripeEmulator>;
