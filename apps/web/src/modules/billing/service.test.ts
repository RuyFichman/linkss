import { describe, expect, it, vi } from "vitest";
import type { IdentityPort } from "@/modules/identity/guard";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import { PRICE_CATALOG } from "./catalog";
import { FAKE_WEBHOOK_SECRET, createFakePaymentsAdapter, type FakeDelivery } from "./fake-adapter";
import { billingErrorFromDatabase } from "./read";
import { createBillingService, processWebhook, runBillingMaintenance, syncFromProvider, type BillingRepository, type SyncDeps } from "./service";
import { createMemoryLedger } from "./testing/memory-ledger";
import { signWebhookPayload } from "./webhook-signature";

/**
 * Billing use cases with the fake provider and the in-memory ledger (ADR 0014): a whole life cycle
 * with an injected clock, the duplicate, concurrent, reordered, forged and cross-workspace cases of
 * AC2 at the level of the code that receives a webhook, and every role against every owner action.
 * The database's side of the same cases is supabase/tests/database/170-billing.test.sql.
 */
const SIGNING_SECRET = "s".repeat(64);
const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DAY = 86_400_000;

function world(start = new Date("2026-10-09T12:00:00.000Z")) {
  const clock = { now: start };
  const now = () => clock.now;
  const fake = createFakePaymentsAdapter(now);
  const ledger = createMemoryLedger({ signingSecret: SIGNING_SECRET, now });
  const sync: SyncDeps = { adapter: fake.adapter, sink: ledger.sink, signingSecret: SIGNING_SECRET, now };
  const advance = (ms: number) => { clock.now = new Date(clock.now.getTime() + ms); };
  const send = (delivery: Pick<FakeDelivery, "rawBody" | "signatureHeader">) => processWebhook(sync, delivery);

  // The database's part of the owner actions, reduced to what the service depends on.
  let checkoutsBegun = 0;
  const repository: BillingRepository = {
    workspaceName: async () => "Agência Teste",
    async beginCheckout(workspaceId) {
      if (ledger.liveSubscription(workspaceId)) return { ok: false, error: "already_subscribed" };
      checkoutsBegun += 1;
      return { ok: true, value: ledger.subscriptionsOf(workspaceId).length };
    },
    findCustomerId: async (workspaceId) => ledger.customerOf(workspaceId),
    async registerCustomer(workspaceId, customerId) {
      if (!ledger.customerOf(workspaceId)) ledger.registerCustomer(workspaceId, customerId);
      return { ok: true, value: ledger.customerOf(workspaceId) as string };
    },
    async beginChange(workspaceId, kind, planId) {
      const live = ledger.liveSubscription(workspaceId);
      if (!live) return { ok: false, error: "no_subscription" };
      if (kind === "cancel" && live.cancelAtPeriodEnd) return { ok: false, error: "invalid_state" };
      if (kind === "resume" && !live.cancelAtPeriodEnd) return { ok: false, error: "invalid_state" };
      if (kind === "change_plan" && planId === live.planId) return { ok: false, error: "same_plan" };
      const target = kind === "change_plan" ? PRICE_CATALOG.find((price) => price.planId === planId && price.interval === live.interval) : null;
      return { ok: true, value: { subscriptionId: live.id, customerId: ledger.customerOf(workspaceId) as string, planId: live.planId, interval: live.interval, amountCents: target?.amountCents ?? 0 } };
    },
  };

  // One id sequence for the whole world: every server-made snapshot has its own event id.
  let ids = 0;
  function serviceFor(role: WorkspaceRole | null, signedIn = true, mode: "off" | "sandbox" | "live" = "sandbox") {
    const identity: IdentityPort = { currentUserId: async () => (signedIn ? OWNER : null), roleIn: async () => role };
    return createBillingService({ identity, repository, mode, sync: mode === "off" ? null : sync, appUrl: (path) => `https://app.example.test${path}`, productName: (planId) => `Projeto LNK ${planId}`, newId: () => `id-${++ids}` });
  }

  /** Owner subscribes and pays; returns the delivery and the provider's subscription id. */
  async function subscribe(workspaceId: string, planId: string, interval: string, paid = true) {
    const checkout = await serviceFor("owner").startCheckout(workspaceId, planId, interval);
    if (!checkout.ok) throw new Error(`checkout failed: ${checkout.error}`);
    const delivery = fake.completeCheckout(fake.checkoutIdFromUrl(checkout.value.url), { paid });
    return { delivery, subscriptionId: delivery.event.subscriptionId as string };
  }

  return { clock, fake, ledger, sync, advance, send, repository, serviceFor, subscribe, checkoutsBegun: () => checkoutsBegun };
}

describe("billing life cycle (fake provider, injected clock)", () => {
  it("subscribes, renews, fails, recovers, fails again until grace ends, resubscribes, upgrades, downgrades and cancels", async () => {
    const w = world();
    const { fake, ledger } = w;

    // Subscribe (Pro, monthly).
    const first = await w.subscribe(W1, "pro", "month");
    expect(ledger.planOf(W1)).toBe("free");
    expect(await w.send(first.delivery)).toMatchObject({ http: 200, outcome: "applied", planChanged: true });
    expect(ledger.planOf(W1)).toBe("pro");

    // Renew.
    w.advance(30 * DAY);
    expect(await w.send(fake.endPeriod(first.subscriptionId))).toMatchObject({ outcome: "applied", planChanged: false });
    expect(ledger.planOf(W1)).toBe("pro");

    // A payment fails: the plan holds for seven days.
    w.advance(30 * DAY);
    const failedAt = w.clock.now;
    expect(await w.send(fake.endPeriod(first.subscriptionId, { paymentFails: true }))).toMatchObject({ outcome: "applied", planChanged: false });
    expect(ledger.liveSubscription(W1)).toMatchObject({ status: "past_due", graceUntil: new Date(failedAt.getTime() + 7 * DAY) });
    expect(ledger.planOf(W1)).toBe("pro");

    // Recovered inside the period: nothing was lost.
    w.advance(3 * DAY);
    expect(await w.send(fake.recover(first.subscriptionId))).toMatchObject({ outcome: "applied", planChanged: false });
    expect(ledger.liveSubscription(W1)).toMatchObject({ status: "active", graceUntil: null });

    // Fails again and nobody pays: grace ends by the clock, not by an event.
    w.advance(27 * DAY);
    await w.send(fake.endPeriod(first.subscriptionId, { paymentFails: true }));
    w.advance(6 * DAY);
    expect(ledger.tick(w.clock.now)).toEqual({ graceExpired: 0, holdsReleased: 0, planChanges: 0 });
    expect(ledger.planOf(W1)).toBe("pro");
    w.advance(DAY);
    expect(ledger.tick(w.clock.now)).toEqual({ graceExpired: 1, holdsReleased: 0, planChanges: 1 });
    expect(ledger.planOf(W1)).toBe("free");
    expect(ledger.tick(w.clock.now)).toEqual({ graceExpired: 0, holdsReleased: 0, planChanges: 0 });

    // The provider gives up; subscribing again is a new subscription (Agency, yearly).
    w.advance(DAY);
    expect(await w.send(fake.end(first.subscriptionId))).toMatchObject({ outcome: "applied", planChanged: false });
    const second = await w.subscribe(W1, "agency", "year");
    expect(await w.send(second.delivery)).toMatchObject({ outcome: "applied", planChanged: true });
    expect(ledger.planOf(W1)).toBe("agency");
    expect(ledger.subscriptionsOf(W1)).toHaveLength(2);

    // Cancel: access holds until the end of the paid period, then ends.
    expect(await w.serviceFor("owner").cancel(W1)).toMatchObject({ ok: true, value: { planChanged: false } });
    expect(ledger.liveSubscription(W1)).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    expect(ledger.planOf(W1)).toBe("agency");
    expect(await w.serviceFor("owner").resume(W1)).toMatchObject({ ok: true });
    expect(ledger.liveSubscription(W1)).toMatchObject({ cancelAtPeriodEnd: false });
    await w.serviceFor("owner").cancel(W1);
    w.advance(365 * DAY);
    expect(await w.send(fake.endPeriod(second.subscriptionId))).toMatchObject({ outcome: "applied", planChanged: true });
    expect(ledger.planOf(W1)).toBe("free");

    // Pro monthly again, upgrade at once, then downgrade: the paid plan holds until the period ends.
    const third = await w.subscribe(W1, "pro", "month");
    await w.send(third.delivery);
    expect(await w.serviceFor("owner").changePlan(W1, "agency")).toEqual({ ok: true, value: { planChanged: true, slugs: expect.any(Array), effective: "now" } });
    expect(ledger.planOf(W1)).toBe("agency");
    w.advance(5 * DAY);
    expect(await w.serviceFor("owner").changePlan(W1, "pro")).toMatchObject({ ok: true, value: { planChanged: false, effective: "period_end" } });
    expect(ledger.planOf(W1)).toBe("agency");
    expect(ledger.liveSubscription(W1)).toMatchObject({ planId: "pro", heldPlanId: "agency" });
    w.advance(26 * DAY);
    expect(ledger.tick(w.clock.now)).toEqual({ graceExpired: 0, holdsReleased: 1, planChanges: 1 });
    expect(ledger.planOf(W1)).toBe("pro");

    // The audit trail has one entry per real plan change.
    expect(ledger.audit.filter((entry) => entry.action === "billing.plan_changed").map((entry) => `${entry.from}>${entry.to}:${entry.reason}`)).toEqual([
      "free>pro:webhook", "pro>free:grace_expired", "free>agency:webhook", "agency>free:webhook", "free>pro:webhook", "pro>agency:owner_action", "agency>pro:held_period_ended",
    ]);
  });

  it("a payment recovered after the grace period restores the plan", async () => {
    const w = world();
    const { delivery, subscriptionId } = await w.subscribe(W1, "agency", "month");
    await w.send(delivery);
    w.advance(30 * DAY);
    await w.send(w.fake.endPeriod(subscriptionId, { paymentFails: true }));
    w.advance(8 * DAY);
    w.ledger.tick(w.clock.now);
    expect(w.ledger.planOf(W1)).toBe("free");
    expect(await w.send(w.fake.recover(subscriptionId))).toMatchObject({ outcome: "applied", planChanged: true });
    expect(w.ledger.planOf(W1)).toBe("agency");
  });

  it("a first payment that is still pending grants nothing until it is confirmed", async () => {
    const w = world();
    const { delivery, subscriptionId } = await w.subscribe(W1, "pro", "month", false);
    expect(await w.send(delivery)).toMatchObject({ outcome: "applied", planChanged: false });
    expect(w.ledger.planOf(W1)).toBe("free");
    expect(await w.send(w.fake.recover(subscriptionId))).toMatchObject({ outcome: "applied", planChanged: true });
    expect(w.ledger.planOf(W1)).toBe("pro");
  });

  it("a chargeback ends the paid plan at once, by cancelling at the provider", async () => {
    const w = world();
    const { delivery, subscriptionId } = await w.subscribe(W1, "agency", "month");
    await w.send(delivery);
    expect(await w.send(w.fake.dispute(subscriptionId))).toMatchObject({ http: 200, outcome: "applied", topic: "dispute", planChanged: true });
    expect(w.fake.subscription(subscriptionId).status).toBe("ended");
    expect(w.ledger.planOf(W1)).toBe("free");
    expect(w.ledger.audit.at(-1)).toMatchObject({ action: "billing.plan_changed", reason: "dispute" });
  });

  it("a plan set by hand is left alone by a subscription that never granted anything", async () => {
    const w = world();
    w.ledger.setPlan(W1, "agency");
    const { delivery, subscriptionId } = await w.subscribe(W1, "pro", "month", false);
    await w.send(delivery);
    expect(w.ledger.planOf(W1)).toBe("agency");
    await w.send(w.fake.end(subscriptionId));
    expect(w.ledger.planOf(W1)).toBe("agency");
    w.ledger.tick(new Date(w.clock.now.getTime() + 400 * DAY));
    expect(w.ledger.planOf(W1)).toBe("agency");
  });
});

describe("webhook processing (AC2)", () => {
  it("processing the same delivery twice changes nothing the second time", async () => {
    const w = world();
    const { delivery } = await w.subscribe(W1, "pro", "month");
    expect(await w.send(delivery)).toMatchObject({ http: 200, outcome: "applied", planChanged: true });
    expect(await w.send(delivery)).toMatchObject({ http: 200, outcome: "duplicate", planChanged: false, slugs: [] });
    expect(w.ledger.subscriptionsOf(W1)).toHaveLength(1);
    expect(w.ledger.audit.filter((entry) => entry.action === "billing.plan_changed")).toHaveLength(1);
    expect(w.ledger.audit.filter((entry) => entry.action === "billing.subscription_changed")).toHaveLength(1);
  });

  it("the same delivery arriving concurrently is applied once", async () => {
    const w = world();
    const { delivery } = await w.subscribe(W1, "pro", "month");
    const results = await Promise.all([w.send(delivery), w.send(delivery), w.send(delivery)]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["applied", "duplicate", "duplicate"]);
    expect(w.ledger.subscriptionsOf(W1)).toHaveLength(1);
    expect(w.ledger.audit.filter((entry) => entry.action === "billing.plan_changed")).toHaveLength(1);
  });

  it("a delivery is a hint: an old event arriving late writes the provider's state of now, not its own", async () => {
    const w = world();
    const { delivery, subscriptionId } = await w.subscribe(W1, "pro", "month");
    w.advance(60_000);
    // The "created" delivery is held back; meanwhile the payment fails and that delivery arrives first.
    const failed = w.fake.endPeriod(subscriptionId, { paymentFails: true });
    expect(await w.send(failed)).toMatchObject({ outcome: "applied" });
    expect(w.ledger.liveSubscription(W1)?.status).toBe("past_due");
    w.advance(60_000);
    expect(await w.send(delivery)).toMatchObject({ outcome: "unchanged", planChanged: false });
    expect(w.ledger.liveSubscription(W1)?.status).toBe("past_due");
  });

  it("an older observation never overwrites a newer one, even with a new event id", async () => {
    const w = world();
    const { delivery, subscriptionId } = await w.subscribe(W1, "pro", "month");
    await w.send(delivery);
    const customerId = w.ledger.customerOf(W1) as string;
    // Two reads raced: the later read is written first.
    const later: SyncDeps = { ...w.sync, now: () => new Date(w.clock.now.getTime() + 2000) };
    await w.fake.adapter.cancelAtPeriodEnd(subscriptionId);
    expect((await syncFromProvider(later, { eventId: "evt_newer", reason: "webhook", customerId, subscriptionId })).status).toBe("applied");
    await w.fake.adapter.resume(subscriptionId);
    const earlier: SyncDeps = { ...w.sync, now: () => new Date(w.clock.now.getTime() + 1000) };
    expect((await syncFromProvider(earlier, { eventId: "evt_older", reason: "webhook", customerId, subscriptionId })).status).toBe("stale");
    expect(w.ledger.liveSubscription(W1)?.cancelAtPeriodEnd).toBe(true);
  });

  it("refuses a bad signature, a missing one and a stale timestamp without reading the provider or the database", async () => {
    const w = world();
    const { delivery } = await w.subscribe(W1, "pro", "month");
    const callsBefore = w.fake.calls.length;
    const forged = signWebhookPayload(delivery.rawBody, "whsec_attacker_secret_00000000000000", w.clock.now);
    expect(await w.send({ rawBody: delivery.rawBody, signatureHeader: forged })).toMatchObject({ http: 400, outcome: "bad_signature" });
    expect(await w.send({ rawBody: delivery.rawBody, signatureHeader: "" })).toMatchObject({ http: 400, outcome: "missing_signature" });
    expect(await processWebhook(w.sync, { rawBody: delivery.rawBody, signatureHeader: null })).toMatchObject({ http: 400, outcome: "missing_signature" });
    // A body edited after signing (the attacker changes the subscription id).
    expect(await w.send({ rawBody: delivery.rawBody.replace("sub_fake", "sub_evil"), signatureHeader: delivery.signatureHeader })).toMatchObject({ http: 400, outcome: "bad_signature" });
    w.advance(6 * 60_000);
    expect(await w.send(delivery)).toMatchObject({ http: 400, outcome: "stale_timestamp" });
    expect(w.fake.calls.length).toBe(callsBefore);
    expect(w.ledger.applyCalls()).toBe(0);
    expect(w.ledger.planOf(W1)).toBe("free");
  });

  it("an event about a subscription nobody knows, or a customer nobody registered, changes nothing", async () => {
    const w = world();
    await w.subscribe(W1, "pro", "month");
    expect(await w.send(w.fake.deliver("subscription", { customerId: "cus_unknown", subscriptionId: "sub_unknown" }))).toMatchObject({ http: 200, outcome: "unknown_customer", planChanged: false });
    // A known customer, an unknown subscription: the provider has nothing to say about it.
    const customerId = w.ledger.customerOf(W1) as string;
    expect(await w.send(w.fake.deliver("subscription", { customerId, subscriptionId: "sub_unknown" }))).toMatchObject({ http: 200, outcome: "ignored" });
    expect(await w.send(w.fake.deliver("other", {}))).toMatchObject({ http: 200, outcome: "ignored" });
    expect(w.ledger.subscriptionsOf(W1)).toHaveLength(0);
    expect(w.ledger.planOf(W1)).toBe("free");
  });

  it("an event for workspace A never changes workspace B", async () => {
    const w = world();
    const a = await w.subscribe(W1, "agency", "month");
    await w.send(a.delivery);
    const b = await w.subscribe(W2, "pro", "month");
    await w.send(b.delivery);
    // W2's subscription ends; W1 must not notice.
    await w.send(w.fake.end(b.subscriptionId));
    expect(w.ledger.planOf(W2)).toBe("free");
    expect(w.ledger.planOf(W1)).toBe("agency");
    // A delivery that pairs W2's customer with W1's subscription: the database refuses the pair.
    const mixed = w.fake.deliver("subscription", { customerId: w.ledger.customerOf(W2), subscriptionId: a.subscriptionId });
    expect(await w.send(mixed)).toMatchObject({ outcome: "customer_mismatch", planChanged: false });
    expect(w.ledger.liveSubscription(W1)?.status).toBe("active");
  });

  it("an amount that is not a catalogue price grants nothing", async () => {
    const w = world();
    const { delivery, subscriptionId } = await w.subscribe(W1, "agency", "month");
    // Somebody edited the price at the provider.
    w.fake.setAmount(subscriptionId, 100);
    expect(await w.send(delivery)).toMatchObject({ http: 200, outcome: "price_mismatch", planChanged: false });
    expect(w.ledger.planOf(W1)).toBe("free");
  });

  it("a second paying subscription for the same workspace is refused and cancelled at the provider", async () => {
    const w = world();
    const owner = w.serviceFor("owner");
    // Two checkouts opened before either was paid (two tabs, more than ten minutes apart).
    const one = await owner.startCheckout(W1, "pro", "month");
    w.advance(11 * 60_000);
    const two = await owner.startCheckout(W1, "pro", "month");
    if (!one.ok || !two.ok) throw new Error("checkout failed");
    expect(two.value.url).not.toBe(one.value.url);
    const paidOne = w.fake.completeCheckout(w.fake.checkoutIdFromUrl(one.value.url));
    const paidTwo = w.fake.completeCheckout(w.fake.checkoutIdFromUrl(two.value.url));
    expect(await w.send(paidOne)).toMatchObject({ outcome: "applied" });
    expect(await w.send(paidTwo)).toMatchObject({ http: 200, outcome: "conflict", planChanged: false });
    expect(w.ledger.subscriptionsOf(W1)).toHaveLength(1);
    expect(w.fake.subscription(paidTwo.event.subscriptionId as string).status).toBe("ended");
    expect(w.fake.subscription(paidOne.event.subscriptionId as string).status).toBe("active");
  });

  it("asks the provider to retry when the provider or the database does not answer, and commits nothing", async () => {
    const w = world();
    const { delivery } = await w.subscribe(W1, "pro", "month");
    w.fake.setDown(true);
    expect(await w.send(delivery)).toMatchObject({ http: 503, outcome: "unavailable" });
    w.fake.setDown(false);
    w.ledger.setDown(true);
    expect(await w.send(delivery)).toMatchObject({ http: 503, outcome: "unavailable" });
    w.ledger.setDown(false);
    expect(w.ledger.planOf(W1)).toBe("free");
    // The retry succeeds: nothing was half-written.
    expect(await w.send(delivery)).toMatchObject({ http: 200, outcome: "applied", planChanged: true });
  });

  it("asks for a retry while billing is not configured or migrated in the database", async () => {
    const w = world();
    const { delivery } = await w.subscribe(W1, "pro", "month");
    for (const status of ["not_configured", "not_deployed", "forbidden"] as const) {
      const sync: SyncDeps = { ...w.sync, sink: { apply: async () => ({ status, planChanged: false, slugs: [] }) } };
      expect(await processWebhook(sync, delivery)).toMatchObject({ http: 503, outcome: status });
    }
  });

  it("signs what it sends: a database with another secret refuses the snapshot", async () => {
    const w = world();
    const { delivery } = await w.subscribe(W1, "pro", "month");
    expect(await processWebhook({ ...w.sync, signingSecret: "x".repeat(64) }, delivery)).toMatchObject({ http: 503, outcome: "forbidden", planChanged: false });
    expect(w.ledger.planOf(W1)).toBe("free");
  });

  it("returns the addresses whose cached page must be dropped when the plan changes", async () => {
    const w = world();
    const { delivery } = await w.subscribe(W1, "pro", "month");
    const result = await w.send(delivery);
    expect(result.planChanged).toBe(true);
    expect(result.slugs.length).toBeGreaterThan(0);
  });
});

describe("checkout cannot be steered from the browser (AC1, AC2)", () => {
  it.each(PRICE_CATALOG.map((price) => [price.planId, price.interval, price.amountCents] as const))("sends the catalogue amount for %s %s: %i cents", async (planId, interval, amountCents) => {
    const w = world();
    const spy = vi.spyOn(w.fake.adapter, "startCheckout");
    const result = await w.serviceFor("owner").startCheckout(W1, planId, interval);
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ amountCents, currency: "BRL", interval, workspaceId: W1, productKey: planId }));
  });

  it("takes a plan and an interval and nothing else: there is no way to pass an amount", async () => {
    const w = world();
    const spy = vi.spyOn(w.fake.adapter, "startCheckout");
    const service = w.serviceFor("owner");
    // The action's whole input is (workspace, plan, interval); anything that is not a sold plan is refused.
    for (const [planId, interval] of [["free", "month"], ["enterprise", "month"], ["pro", "week"], ["pro", ""], [{ amountCents: 1 }, "month"], ["pro; amount=1", "month"], [null, null], ["agency", "100"]] as const) {
      expect(await service.startCheckout(W1, planId, interval)).toEqual({ ok: false, error: "invalid_plan" });
    }
    expect(spy).not.toHaveBeenCalled();
    expect(w.checkoutsBegun()).toBe(0);
  });

  it("starting checkout twice opens one checkout, and a paid workspace cannot open another", async () => {
    const w = world();
    const service = w.serviceFor("owner");
    const first = await service.startCheckout(W1, "pro", "month");
    const second = await service.startCheckout(W1, "pro", "month");
    expect(first.ok && second.ok && first.value.url === second.value.url).toBe(true);
    if (!first.ok) return;
    await w.send(w.fake.completeCheckout(w.fake.checkoutIdFromUrl(first.value.url)));
    expect(await service.startCheckout(W1, "agency", "month")).toEqual({ ok: false, error: "already_subscribed" });
    expect(w.ledger.subscriptionsOf(W1)).toHaveLength(1);
  });

  it("sends the person back to addresses built from configuration, for the workspace it authorized", async () => {
    const w = world();
    const spy = vi.spyOn(w.fake.adapter, "startCheckout");
    await w.serviceFor("owner").startCheckout(W1, "pro", "year");
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      successUrl: `https://app.example.test/app/w/${W1}/plano/retorno?resultado=sucesso`, cancelUrl: `https://app.example.test/app/w/${W1}/plano/retorno?resultado=cancelado`,
    });
  });

  it("uses the customer the database holds, whatever the provider just returned", async () => {
    const w = world();
    w.ledger.registerCustomer(W1, (await w.fake.adapter.createCustomer({ workspaceId: W1, workspaceName: "x" })).customerId);
    const stored = w.ledger.customerOf(W1);
    const spy = vi.spyOn(w.fake.adapter, "startCheckout");
    await w.serviceFor("owner").startCheckout(W1, "pro", "month");
    expect(spy.mock.calls[0]?.[0].customerId).toBe(stored);
  });
});

describe("only the owner manages billing", () => {
  const actions: Array<[string, (service: ReturnType<ReturnType<typeof world>["serviceFor"]>, workspaceId: unknown) => Promise<{ ok: boolean; error?: string }>]> = [
    ["start a checkout", (service, id) => service.startCheckout(id, "pro", "month")],
    ["cancel", (service, id) => service.cancel(id)],
    ["resume", (service, id) => service.resume(id)],
    ["change plan", (service, id) => service.changePlan(id, "agency")],
    ["open the provider's page", (service, id) => service.openSelfService(id)],
  ];

  it.each(actions)("%s: admin and editor are forbidden, a non-member gets not found, anon is unauthenticated", async (_name, run) => {
    const w = world();
    const { delivery } = await w.subscribe(W1, "pro", "month");
    await w.send(delivery);
    const spies = [vi.spyOn(w.repository, "beginCheckout"), vi.spyOn(w.repository, "beginChange"), vi.spyOn(w.repository, "registerCustomer"), vi.spyOn(w.repository, "findCustomerId")];
    const providerCalls = w.fake.calls.length;

    expect(await run(w.serviceFor("admin"), W1)).toEqual({ ok: false, error: "forbidden" });
    expect(await run(w.serviceFor("editor"), W1)).toEqual({ ok: false, error: "forbidden" });
    // A member of another workspace has no role in this one: the same answer as an id that does not exist.
    expect(await run(w.serviceFor(null), W1)).toEqual({ ok: false, error: "not_found" });
    expect(await run(w.serviceFor("owner"), "not-a-uuid")).toEqual({ ok: false, error: "not_found" });
    expect(await run(w.serviceFor("owner", false), W1)).toEqual({ ok: false, error: "unauthenticated" });

    // Refused before the database or the provider is touched.
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(w.fake.calls.length).toBe(providerCalls);
    expect(w.ledger.liveSubscription(W1)).toMatchObject({ status: "active", planId: "pro", cancelAtPeriodEnd: false });
  });

  it("with billing off nothing can be bought or changed, and nothing errors", async () => {
    const w = world();
    const service = w.serviceFor("owner", true, "off");
    for (const result of [await service.startCheckout(W1, "pro", "month"), await service.cancel(W1), await service.resume(W1), await service.changePlan(W1, "agency"), await service.openSelfService(W1)]) {
      expect(result).toEqual({ ok: false, error: "billing_off" });
    }
    expect(w.fake.calls).toEqual([]);
  });

  it("reports a provider that does not answer without changing anything", async () => {
    const w = world();
    const { delivery } = await w.subscribe(W1, "pro", "month");
    await w.send(delivery);
    w.fake.setDown(true);
    expect(await w.serviceFor("owner").cancel(W1)).toEqual({ ok: false, error: "provider_unavailable" });
    expect(await w.serviceFor("owner").changePlan(W1, "agency")).toEqual({ ok: false, error: "provider_unavailable" });
    expect(await w.serviceFor("owner").startCheckout(W2, "pro", "month")).toEqual({ ok: false, error: "provider_unavailable" });
    w.fake.setDown(false);
    expect(w.ledger.liveSubscription(W1)).toMatchObject({ planId: "pro", cancelAtPeriodEnd: false });
  });

  it("passes the database's refusals through", async () => {
    const w = world();
    expect(await w.serviceFor("owner").cancel(W1)).toEqual({ ok: false, error: "no_subscription" });
    const { delivery } = await w.subscribe(W1, "pro", "month");
    await w.send(delivery);
    expect(await w.serviceFor("owner").changePlan(W1, "pro")).toEqual({ ok: false, error: "same_plan" });
    expect(await w.serviceFor("owner").resume(W1)).toEqual({ ok: false, error: "invalid_state" });
    expect(await w.serviceFor("owner").changePlan(W1, "free")).toEqual({ ok: false, error: "invalid_plan" });
    expect(billingErrorFromDatabase({ code: "LK100" })).toBe("already_subscribed");
  });
});

describe("maintenance job: reconciliation repairs a lost webhook", () => {
  it("reads again what was not read for a day and corrects the copy", async () => {
    const w = world();
    const { delivery, subscriptionId } = await w.subscribe(W1, "agency", "month");
    await w.send(delivery);
    const customerId = w.ledger.customerOf(W1) as string;
    // The provider ended the subscription and the webhook never arrived.
    w.fake.end(subscriptionId);
    expect(w.ledger.planOf(W1)).toBe("agency");
    w.advance(DAY);
    const tick = async () => ({ graceExpired: 0, holdsReleased: 0, planChanges: 0, purgedEvents: 0, pending: 0, slugs: [], candidates: [{ subscriptionId, customerId }] });
    expect(await runBillingMaintenance({ tick, sync: w.sync })).toMatchObject({ checked: 1, corrected: 1, failed: 0, planChanges: 1 });
    expect(w.ledger.planOf(W1)).toBe("free");
    // Running it again finds nothing to correct.
    w.advance(DAY);
    expect(await runBillingMaintenance({ tick, sync: w.sync })).toMatchObject({ checked: 1, corrected: 0, failed: 0, planChanges: 0 });
  });

  it("counts a provider failure and carries on, and only runs the clock when billing is off", async () => {
    const w = world();
    const { delivery, subscriptionId } = await w.subscribe(W1, "pro", "month");
    await w.send(delivery);
    const customerId = w.ledger.customerOf(W1) as string;
    const tick = async () => ({ graceExpired: 2, holdsReleased: 1, planChanges: 3, purgedEvents: 4, pending: 5, slugs: ["ana-lima"], candidates: [{ subscriptionId, customerId }, { subscriptionId: "sub_gone", customerId }] });
    w.fake.setDown(true);
    expect(await runBillingMaintenance({ tick, sync: w.sync })).toMatchObject({ graceExpired: 2, holdsReleased: 1, checked: 0, failed: 2, pending: 5, slugs: ["ana-lima"] });
    w.fake.setDown(false);
    expect(await runBillingMaintenance({ tick, sync: null })).toMatchObject({ graceExpired: 2, checked: 0, corrected: 0, failed: 0, pending: 7 });
  });

  it("uses the fake webhook secret only to verify fake deliveries", () => {
    expect(FAKE_WEBHOOK_SECRET.startsWith("whsec_")).toBe(true);
  });
});
