import { describe, expect, it } from "vitest";
import { PaymentsError, type PaymentsAdapter, type ProviderEvent } from "./adapter";
import { PRICE_CATALOG } from "./catalog";
import { FAKE_WEBHOOK_SECRET, createFakePaymentsAdapter } from "./fake-adapter";
import { STRIPE_API_VERSION, createStripeAdapter, encodeStripeForm, mapStripeEvent, mapStripeInvoice, mapStripeSubscription } from "./stripe-adapter";
import { createStripeEmulator } from "./testing/stripe-emulator";
import { signWebhookPayload } from "./webhook-signature";

/**
 * PaymentsAdapter contract (ADR 0014): the same cases against the fake adapter and against the
 * Stripe adapter. The Stripe side talks to the local emulator, whose responses are shaped from
 * Stripe's documentation. No recorded sandbox fixture exists yet (there is no Stripe account), so
 * this proves the adapter against our reading of the documentation, not against Stripe itself.
 */
const T0 = new Date("2026-10-09T12:00:00.000Z");
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const WEBHOOK_SECRET = "whsec_contract_test_secret_0000000000";

interface Delivery {
  rawBody: string;
  signatureHeader: string;
}

/** The provider's side of the story, uniform over both implementations. */
interface Driver {
  name: string;
  adapter: PaymentsAdapter;
  clock: { now: Date };
  /** The customer pays on the hosted page; returns the subscription and one delivery about it. */
  pay(checkoutUrl: string, paid?: boolean): { subscriptionId: string; delivery: Delivery };
  failRenewal(subscriptionId: string): Delivery;
  recover(subscriptionId: string): Delivery;
  endPeriod(subscriptionId: string): Delivery;
  dispute(subscriptionId: string): Delivery;
  /** Signs `rawBody` at `at` with the endpoint secret, or with another one. */
  sign(rawBody: string, at: Date, wrongSecret?: boolean): string;
}

function fakeDriver(): Driver {
  const clock = { now: T0 };
  const fake = createFakePaymentsAdapter(() => clock.now);
  return {
    name: "fake adapter", adapter: fake.adapter, clock,
    pay(url, paid = true) {
      const delivery = fake.completeCheckout(fake.checkoutIdFromUrl(url), { paid });
      return { subscriptionId: delivery.event.subscriptionId as string, delivery };
    },
    failRenewal: (id) => fake.endPeriod(id, { paymentFails: true }),
    recover: (id) => fake.recover(id),
    endPeriod: (id) => fake.endPeriod(id),
    dispute: (id) => fake.dispute(id),
    sign: (rawBody, at, wrongSecret) => signWebhookPayload(rawBody, wrongSecret ? "whsec_wrong" : FAKE_WEBHOOK_SECRET, at),
  };
}

function stripeDriver(): Driver {
  const clock = { now: T0 };
  const emulator = createStripeEmulator({ webhookSecret: WEBHOOK_SECRET, now: () => clock.now, origin: "http://127.0.0.1:4242", runId: "ct" });
  const adapter = createStripeAdapter({ secretKey: "sk_" + "test_contract0000000000000000", webhookSecret: WEBHOOK_SECRET, apiBaseUrl: "http://127.0.0.1:4242", fetch: emulator.fetch });
  const last = <T,>(items: T[]): T => items.at(-1) as T;
  return {
    name: "Stripe adapter (emulator)", adapter, clock,
    pay(url, paid = true) {
      const result = emulator.completeCheckout(emulator.sessionIdFromUrl(url), { paid });
      return { subscriptionId: result.subscriptionId, delivery: last(result.deliveries) };
    },
    failRenewal: (id) => last(emulator.endPeriod(id, { paymentFails: true })),
    recover: (id) => last(emulator.recover(id)),
    endPeriod: (id) => last(emulator.endPeriod(id)),
    dispute: (id) => last(emulator.dispute(id)),
    sign: (rawBody, at, wrongSecret) => emulator.sign(rawBody, at, wrongSecret ? "whsec_wrong" : WEBHOOK_SECRET),
  };
}

const price = (planId: string, interval: string) => PRICE_CATALOG.find((item) => item.planId === planId && item.interval === interval) as (typeof PRICE_CATALOG)[number];

async function subscribe(driver: Driver, planId = "pro", interval = "month", paid = true) {
  const { customerId } = await driver.adapter.createCustomer({ workspaceId: WORKSPACE, workspaceName: "Agência Contrato" });
  const chosen = price(planId, interval);
  const checkout = await driver.adapter.startCheckout({
    workspaceId: WORKSPACE, customerId, productKey: planId, productName: `Linkfav ${planId}`, amountCents: chosen.amountCents, currency: chosen.currency, interval: chosen.interval,
    successUrl: "https://app.example.test/ok", cancelUrl: "https://app.example.test/voltar", idempotencyKey: `key-${planId}-${interval}`,
  });
  return { customerId, checkout, ...driver.pay(checkout.url, paid) };
}

describe.each([["fake", fakeDriver], ["stripe", stripeDriver]] as const)("PaymentsAdapter contract: %s", (_label, makeDriver) => {
  it("creates one customer per workspace, however many times it is asked", async () => {
    const driver = makeDriver();
    const first = await driver.adapter.createCustomer({ workspaceId: WORKSPACE, workspaceName: "Agência" });
    const second = await driver.adapter.createCustomer({ workspaceId: WORKSPACE, workspaceName: "Agência" });
    expect(second.customerId).toBe(first.customerId);
    expect(first.customerId).toMatch(/^[A-Za-z0-9_]{3,255}$/);
  });

  it("opens one checkout for one idempotency key and reports exactly what was asked", async () => {
    const driver = makeDriver();
    const { customerId } = await driver.adapter.createCustomer({ workspaceId: WORKSPACE, workspaceName: "Agência" });
    const request = { workspaceId: WORKSPACE, customerId, productKey: "agency", productName: "Linkfav Agência", amountCents: 57900, currency: "BRL" as const, interval: "year" as const, successUrl: "https://app.example.test/ok", cancelUrl: "https://app.example.test/voltar", idempotencyKey: "same-key" };
    const first = await driver.adapter.startCheckout(request);
    const again = await driver.adapter.startCheckout(request);
    expect(again.url).toBe(first.url);
    const other = await driver.adapter.startCheckout({ ...request, idempotencyKey: "other-key" });
    expect(other.url).not.toBe(first.url);

    const { subscriptionId } = driver.pay(first.url);
    expect(await driver.adapter.fetchSubscription(subscriptionId)).toMatchObject({
      id: subscriptionId, customerId, workspaceId: WORKSPACE, status: "active", amountCents: 57900, currency: "BRL", interval: "year", cancelAtPeriodEnd: false,
    });
  });

  it.each(PRICE_CATALOG.map((item) => [item.planId, item.interval, item.amountCents] as const))("charges the catalogue amount for %s %s (%i cents)", async (planId, interval, amountCents) => {
    const driver = makeDriver();
    const { subscriptionId } = await subscribe(driver, planId, interval);
    const subscription = await driver.adapter.fetchSubscription(subscriptionId);
    expect(subscription).toMatchObject({ amountCents, interval, currency: "BRL" });
    expect(subscription?.currentPeriodEnd?.getTime()).toBeGreaterThan(T0.getTime());
  });

  it("reports a first payment that is still pending as incomplete", async () => {
    const driver = makeDriver();
    const { subscriptionId } = await subscribe(driver, "pro", "month", false);
    expect((await driver.adapter.fetchSubscription(subscriptionId))?.status).toBe("incomplete");
    expect((await driver.adapter.listInvoices(subscriptionId, 12))[0]).toMatchObject({ status: "open", paidAt: null });
  });

  it("follows a failed renewal and its recovery", async () => {
    const driver = makeDriver();
    const { subscriptionId } = await subscribe(driver);
    driver.failRenewal(subscriptionId);
    expect((await driver.adapter.fetchSubscription(subscriptionId))?.status).toBe("past_due");
    driver.recover(subscriptionId);
    expect((await driver.adapter.fetchSubscription(subscriptionId))?.status).toBe("active");
    const invoices = await driver.adapter.listInvoices(subscriptionId, 12);
    expect(invoices.map((invoice) => invoice.status)).toEqual(["paid", "paid"]);
    for (const invoice of invoices) {
      expect(invoice.receiptUrl).toMatch(/^https:\/\//);
      expect(invoice.currency).toBe("BRL");
      expect(invoice.paidAt).toBeInstanceOf(Date);
    }
    expect(await driver.adapter.listInvoices(subscriptionId, 1)).toHaveLength(1);
  });

  it("cancels at the end of the period, resumes, and ends when the period closes", async () => {
    const driver = makeDriver();
    const { subscriptionId } = await subscribe(driver);
    await driver.adapter.cancelAtPeriodEnd(subscriptionId);
    expect(await driver.adapter.fetchSubscription(subscriptionId)).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    await driver.adapter.resume(subscriptionId);
    expect(await driver.adapter.fetchSubscription(subscriptionId)).toMatchObject({ status: "active", cancelAtPeriodEnd: false });
    await driver.adapter.cancelAtPeriodEnd(subscriptionId);
    driver.endPeriod(subscriptionId);
    expect((await driver.adapter.fetchSubscription(subscriptionId))?.status).toBe("ended");
  });

  it("changes the plan: the new catalogue amount, the same interval", async () => {
    const driver = makeDriver();
    const { subscriptionId } = await subscribe(driver, "pro", "month");
    await driver.adapter.changePlan({ subscriptionId, productKey: "agency", productName: "Linkfav Agência", amountCents: 5790, currency: "BRL", interval: "month", effective: "now", idempotencyKey: "up" });
    expect(await driver.adapter.fetchSubscription(subscriptionId)).toMatchObject({ amountCents: 5790, interval: "month", status: "active" });
    // An upgrade charges the difference at once.
    expect((await driver.adapter.listInvoices(subscriptionId, 12))[0]).toMatchObject({ status: "paid", amountCents: 5790 - 1490 });
    await driver.adapter.changePlan({ subscriptionId, productKey: "pro", productName: "Linkfav Pro", amountCents: 1490, currency: "BRL", interval: "month", effective: "period_end", idempotencyKey: "down" });
    expect(await driver.adapter.fetchSubscription(subscriptionId)).toMatchObject({ amountCents: 1490 });
    // A downgrade charges and credits nothing now.
    expect(await driver.adapter.listInvoices(subscriptionId, 12)).toHaveLength(2);
  });

  it("ends a subscription at once and tolerates doing it twice", async () => {
    const driver = makeDriver();
    const { subscriptionId } = await subscribe(driver);
    await driver.adapter.cancelNow(subscriptionId);
    await driver.adapter.cancelNow(subscriptionId);
    await driver.adapter.cancelNow("sub_does_not_exist");
    expect((await driver.adapter.fetchSubscription(subscriptionId))?.status).toBe("ended");
  });

  it("finds the customer's latest subscription and the customer of a disputed charge", async () => {
    const driver = makeDriver();
    const { customerId, subscriptionId } = await subscribe(driver);
    expect((await driver.adapter.findCustomerSubscription(customerId))?.id).toBe(subscriptionId);
    expect(await driver.adapter.findCustomerSubscription("cus_nobody")).toBeNull();
    const verified = driver.adapter.verifyWebhook({ ...driver.dispute(subscriptionId), now: driver.clock.now });
    expect(verified).toMatchObject({ ok: true, event: { topic: "dispute", customerId: null } });
    const chargeId = (verified as { ok: true; event: ProviderEvent }).event.chargeId as string;
    expect(await driver.adapter.findChargeCustomer(chargeId)).toBe(customerId);
    expect(await driver.adapter.findChargeCustomer("ch_nobody")).toBeNull();
  });

  it("answers null for a subscription that does not exist", async () => {
    expect(await makeDriver().adapter.fetchSubscription("sub_does_not_exist")).toBeNull();
  });

  it("opens the provider's self-service page for a known customer", async () => {
    const driver = makeDriver();
    const { customerId } = await driver.adapter.createCustomer({ workspaceId: WORKSPACE, workspaceName: "Agência" });
    const session = await driver.adapter.openSelfService({ customerId, returnUrl: "https://app.example.test/plano" });
    expect(session?.url).toMatch(/^https?:\/\//);
  });

  it("verifies a delivery it signed and names what it is about", async () => {
    const driver = makeDriver();
    const { customerId, subscriptionId, delivery } = await subscribe(driver);
    const verified = driver.adapter.verifyWebhook({ ...delivery, now: driver.clock.now });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.event).toMatchObject({ customerId, subscriptionId });
    expect(["subscription", "invoice", "checkout"]).toContain(verified.event.topic);
    expect(verified.event.id).toMatch(/^[A-Za-z0-9_]{3,255}$/);
  });

  it("refuses a forged, replayed, unsigned or malformed delivery before reading it", async () => {
    const driver = makeDriver();
    const { delivery } = await subscribe(driver);
    const now = driver.clock.now;
    const later = new Date(now.getTime() + 6 * 60_000);
    expect(driver.adapter.verifyWebhook({ rawBody: delivery.rawBody, signatureHeader: null, now })).toEqual({ ok: false, reason: "missing_signature" });
    expect(driver.adapter.verifyWebhook({ rawBody: delivery.rawBody, signatureHeader: driver.sign(delivery.rawBody, now, true), now })).toEqual({ ok: false, reason: "bad_signature" });
    // The body changed after signing.
    expect(driver.adapter.verifyWebhook({ rawBody: delivery.rawBody.replace("{", "{ "), signatureHeader: delivery.signatureHeader, now })).toEqual({ ok: false, reason: "bad_signature" });
    // A captured delivery sent again later.
    expect(driver.adapter.verifyWebhook({ rawBody: delivery.rawBody, signatureHeader: delivery.signatureHeader, now: later })).toEqual({ ok: false, reason: "stale_timestamp" });
    // Correctly signed, but not an event.
    for (const rawBody of ["not json", "[]", '{"id":7}']) {
      expect(driver.adapter.verifyWebhook({ rawBody, signatureHeader: driver.sign(rawBody, now), now })).toEqual({ ok: false, reason: "malformed" });
    }
  });
});

describe("Stripe adapter specifics", () => {
  it("encodes nested parameters the way the API takes them", () => {
    expect(decodeURIComponent(encodeStripeForm({ mode: "subscription", line_items: [{ quantity: 1, price_data: { unit_amount: 1490, recurring: { interval: "month" } } }], metadata: { workspace_id: "w 1" } })))
      .toBe("mode=subscription&line_items[0][quantity]=1&line_items[0][price_data][unit_amount]=1490&line_items[0][price_data][recurring][interval]=month&metadata[workspace_id]=w 1");
  });

  it("sends the catalogue amount, the workspace and the pinned API version, and never a card", async () => {
    const emulator = createStripeEmulator({ webhookSecret: WEBHOOK_SECRET, now: () => T0, origin: "http://127.0.0.1:4242" });
    const seen: Array<{ url: string; headers: Headers; body: string }> = [];
    const adapter = createStripeAdapter({
      secretKey: "sk_" + "test_contract0000000000000000", webhookSecret: WEBHOOK_SECRET, apiBaseUrl: "http://127.0.0.1:4242",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(input), headers: new Headers(init?.headers), body: typeof init?.body === "string" ? init.body : "" });
        return emulator.fetch(input, init);
      }) as typeof fetch,
    });
    const { customerId } = await adapter.createCustomer({ workspaceId: WORKSPACE, workspaceName: "Agência" });
    await adapter.startCheckout({ workspaceId: WORKSPACE, customerId, productKey: "pro", productName: "Linkfav Pro", amountCents: 1490, currency: "BRL", interval: "month", successUrl: "https://app.example.test/ok", cancelUrl: "https://app.example.test/voltar", idempotencyKey: "k1" });

    const checkout = seen.find((call) => call.url.endsWith("/v1/checkout/sessions"));
    const form = new URLSearchParams(checkout?.body);
    expect(Object.fromEntries(form)).toEqual({
      mode: "subscription", customer: customerId, client_reference_id: WORKSPACE, locale: "pt-BR",
      success_url: "https://app.example.test/ok", cancel_url: "https://app.example.test/voltar",
      "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "brl", "line_items[0][price_data][product]": "lnk_plan_pro",
      "line_items[0][price_data][unit_amount]": "1490", "line_items[0][price_data][recurring][interval]": "month",
      "metadata[workspace_id]": WORKSPACE, "subscription_data[metadata][workspace_id]": WORKSPACE,
    });
    expect(checkout?.headers.get("idempotency-key")).toBe("k1");
    for (const call of seen) {
      expect(call.headers.get("stripe-version")).toBe(STRIPE_API_VERSION);
      expect(call.headers.get("authorization")).toBe("Bearer sk_" + "test_contract0000000000000000");
      expect(call.body).not.toMatch(/card|cpf|cnpj|tax_id|email/i);
    }
  });

  it("maps every Stripe status to one of the product's four", () => {
    const subscription = (status: string) => mapStripeSubscription({ id: "sub_1", customer: "cus_1", status, cancel_at_period_end: false, cancel_at: null, metadata: { workspace_id: WORKSPACE }, items: { data: [{ id: "si_1", current_period_end: 1_800_000_000, price: { unit_amount: 1490, currency: "brl", recurring: { interval: "month" } } }] } })?.status;
    expect(["incomplete", "incomplete_expired", "trialing", "active", "past_due", "unpaid", "paused", "canceled"].map(subscription))
      .toEqual(["incomplete", "ended", "active", "active", "past_due", "past_due", "past_due", "ended"]);
    expect(subscription("something_new")).toBeUndefined();
  });

  it("reads the period from the item or from the subscription, and a portal cancellation as scheduled", () => {
    const base = { id: "sub_1", customer: { id: "cus_1" }, status: "active", cancel_at_period_end: false, cancel_at: null, metadata: {}, items: { data: [{ id: "si_1", price: { unit_amount: 5790, currency: "brl", recurring: { interval: "month" } } }] } };
    expect(mapStripeSubscription({ ...base, current_period_end: 1_800_000_000 })).toMatchObject({ customerId: "cus_1", workspaceId: null, currentPeriodEnd: new Date(1_800_000_000_000), cancelAtPeriodEnd: false });
    expect(mapStripeSubscription({ ...base, cancel_at: 1_800_000_000 })?.cancelAtPeriodEnd).toBe(true);
    expect(mapStripeSubscription({ ...base, metadata: { workspace_id: "not-a-uuid" } })?.workspaceId).toBeNull();
    // Anything the product cannot price is not a subscription it understands.
    expect(mapStripeSubscription({ ...base, items: { data: [{ id: "si_1", price: { unit_amount: 5790, currency: "brl", recurring: { interval: "week" } } }] } })).toBeNull();
    expect(mapStripeSubscription({ ...base, items: { data: [] } })).toBeNull();
    expect(mapStripeSubscription(null)).toBeNull();
  });

  it("maps invoices, skipping drafts and non-https receipt links", () => {
    const invoice = { id: "in_1", status: "paid", currency: "brl", created: 1_800_000_000, amount_paid: 1490, amount_due: 1490, hosted_invoice_url: "https://invoice.stripe.example.test/in_1", status_transitions: { paid_at: 1_800_000_100 } };
    expect(mapStripeInvoice(invoice)).toEqual({ id: "in_1", amountCents: 1490, currency: "BRL", status: "paid", paidAt: new Date(1_800_000_100_000), createdAt: new Date(1_800_000_000_000), receiptUrl: "https://invoice.stripe.example.test/in_1" });
    expect(mapStripeInvoice({ ...invoice, status: "open", amount_paid: 0 })).toMatchObject({ status: "open", amountCents: 1490, paidAt: null });
    expect(mapStripeInvoice({ ...invoice, status: "draft" })).toBeNull();
    expect(mapStripeInvoice({ ...invoice, hosted_invoice_url: "javascript:alert(1)" })?.receiptUrl).toBeNull();
  });

  it("reduces an event to what is needed to read the state again", () => {
    const event = (type: string, object: Record<string, unknown>) => mapStripeEvent({ id: "evt_1", type, data: { object } });
    expect(event("customer.subscription.updated", { id: "sub_1", customer: "cus_1" })).toEqual({ id: "evt_1", topic: "subscription", customerId: "cus_1", subscriptionId: "sub_1", chargeId: null });
    expect(event("invoice.paid", { id: "in_1", customer: "cus_1", parent: { subscription_details: { subscription: "sub_1" } } })).toMatchObject({ topic: "invoice", customerId: "cus_1", subscriptionId: "sub_1" });
    expect(event("invoice.payment_failed", { id: "in_1", customer: "cus_1", subscription: "sub_old_api" })).toMatchObject({ topic: "invoice", subscriptionId: "sub_old_api" });
    expect(event("checkout.session.completed", { id: "cs_1", customer: "cus_1", subscription: "sub_1" })).toMatchObject({ topic: "checkout", customerId: "cus_1", subscriptionId: "sub_1" });
    expect(event("charge.dispute.created", { id: "dp_1", charge: "ch_1" })).toMatchObject({ topic: "dispute", chargeId: "ch_1", customerId: null });
    expect(event("charge.refunded", { id: "ch_1", customer: "cus_1" })).toMatchObject({ topic: "refund", customerId: "cus_1" });
    expect(event("product.updated", { id: "prod_1" })).toMatchObject({ topic: "other", customerId: null, subscriptionId: null });
    expect(mapStripeEvent({ id: "evt_1", type: "invoice.paid" })).toBeNull();
    expect(mapStripeEvent({ type: "invoice.paid", data: { object: {} } })).toBeNull();
  });

  it("turns provider failures into three kinds and never surfaces the provider's message", async () => {
    const failing = (status: number, body: unknown) => createStripeAdapter({ secretKey: "sk_test_x", webhookSecret: WEBHOOK_SECRET, fetch: (async () => new Response(JSON.stringify(body), { status })) as typeof fetch });
    const kind = async (work: Promise<unknown>) => work.then(() => "ok", (error: unknown) => (error instanceof PaymentsError ? `${error.kind}:${error.providerCode}:${error.message}` : "other"));
    expect(await kind(failing(500, {}).createCustomer({ workspaceId: WORKSPACE, workspaceName: "A" }))).toBe("unavailable:null:Payment provider call failed: unavailable");
    expect(await kind(failing(429, { error: { code: "rate_limit" } }).createCustomer({ workspaceId: WORKSPACE, workspaceName: "A" }))).toMatch(/^unavailable:rate_limit/);
    expect(await kind(failing(402, { error: { code: "card_declined", message: "Card 4242 declined for joana@example.test" } }).createCustomer({ workspaceId: WORKSPACE, workspaceName: "A" }))).toBe("rejected:card_declined:Payment provider call failed: rejected");
    const offline = createStripeAdapter({ secretKey: "sk_test_x", webhookSecret: WEBHOOK_SECRET, fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    expect(await kind(offline.fetchSubscription("sub_1"))).toMatch(/^unavailable/);
    // A hosted page that is not https is not followed.
    const strange = createStripeAdapter({ secretKey: "sk_test_x", webhookSecret: WEBHOOK_SECRET, fetch: (async () => new Response(JSON.stringify({ id: "x", url: "http://evil.example/pay" }), { status: 200 })) as typeof fetch });
    expect(await kind(strange.openSelfService({ customerId: "cus_1", returnUrl: "https://app.example.test" }))).toMatch(/^rejected/);
  });
});
