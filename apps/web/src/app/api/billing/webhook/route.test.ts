import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_WEBHOOK_SECRET, createFakePaymentsAdapter } from "@/modules/billing/fake-adapter";
import { signWebhookPayload } from "@/modules/billing/webhook-signature";
import type { SyncDeps } from "@/modules/billing/service";
import { createMemoryLedger } from "@/modules/billing/testing/memory-ledger";

const mocks = vi.hoisted(() => ({ configuredSync: vi.fn(), revalidatePublicPage: vi.fn() }));
vi.mock("@/modules/billing/server", () => ({ configuredSync: mocks.configuredSync }));
vi.mock("@/modules/publishing/cache", () => ({ revalidatePublicPage: mocks.revalidatePublicPage }));

const { POST } = await import("./route");

const SIGNING_SECRET = "s".repeat(64);
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-09T12:00:00.000Z");

function setup() {
  const fake = createFakePaymentsAdapter(() => NOW);
  const ledger = createMemoryLedger({ signingSecret: SIGNING_SECRET, now: () => NOW });
  const sync: SyncDeps = { adapter: fake.adapter, sink: ledger.sink, signingSecret: SIGNING_SECRET, now: () => NOW };
  mocks.configuredSync.mockReturnValue(sync);
  return { fake, ledger };
}

async function paidCheckout(fake: ReturnType<typeof setup>["fake"], ledger: ReturnType<typeof setup>["ledger"]) {
  const { customerId } = await fake.adapter.createCustomer({ workspaceId: WORKSPACE, workspaceName: "Agência" });
  ledger.registerCustomer(WORKSPACE, customerId);
  const checkout = await fake.adapter.startCheckout({ workspaceId: WORKSPACE, customerId, productKey: "pro", productName: "Pro", amountCents: 1490, currency: "BRL", interval: "month", successUrl: "https://a.test/ok", cancelUrl: "https://a.test/no", idempotencyKey: "k" });
  return fake.completeCheckout(fake.checkoutIdFromUrl(checkout.url));
}

function post(body: string, signature?: string | null, headers: Record<string, string> = {}) {
  return POST(new Request("https://exemplo.test/api/billing/webhook", { method: "POST", body, headers: { "content-type": "application/json", ...(signature ? { "stripe-signature": signature } : {}), ...headers } }));
}

function logged(): Array<Record<string, unknown>> {
  return [console.info, console.warn, console.error].flatMap((spy) => vi.mocked(spy).mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>));
}

describe("billing webhook route", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.configuredSync.mockReset();
    mocks.revalidatePublicPage.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("applies a verified delivery, answers 200 without details and drops the cached pages of the workspace", async () => {
    const { fake, ledger } = setup();
    const delivery = await paidCheckout(fake, ledger);
    const response = await post(delivery.rawBody, delivery.signatureHeader);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(ledger.planOf(WORKSPACE)).toBe("pro");
    // AC5: the badge of a page that is already published follows the plan at once.
    expect(mocks.revalidatePublicPage).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePublicPage.mock.calls[0]?.[0]).toMatch(/^[a-z0-9-]{3,40}$/);
  });

  it("answers 200 and changes nothing when the same delivery arrives again", async () => {
    const { fake, ledger } = setup();
    const delivery = await paidCheckout(fake, ledger);
    await post(delivery.rawBody, delivery.signatureHeader);
    mocks.revalidatePublicPage.mockClear();
    const again = await post(delivery.rawBody, delivery.signatureHeader);
    expect(again.status).toBe(200);
    expect(mocks.revalidatePublicPage).not.toHaveBeenCalled();
    expect(ledger.subscriptionsOf(WORKSPACE)).toHaveLength(1);
    expect(logged().at(-1)).toMatchObject({ event: "billing.webhook", outcome: "duplicate" });
  });

  it("refuses an unsigned, forged or stale delivery with 400 and touches nothing", async () => {
    const { fake, ledger } = setup();
    const delivery = await paidCheckout(fake, ledger);
    const calls = fake.calls.length;
    expect((await post(delivery.rawBody, null)).status).toBe(400);
    expect((await post(delivery.rawBody, `t=${Math.floor(NOW.getTime() / 1000)},v1=${"0".repeat(64)}`)).status).toBe(400);
    expect((await post(`${delivery.rawBody} `, delivery.signatureHeader)).status).toBe(400);
    // A real delivery captured and sent again ten minutes later.
    expect((await post(delivery.rawBody, signWebhookPayload(delivery.rawBody, FAKE_WEBHOOK_SECRET, new Date(NOW.getTime() - 10 * 60_000)))).status).toBe(400);
    expect(fake.calls.length).toBe(calls);
    expect(ledger.applyCalls()).toBe(0);
    expect(ledger.planOf(WORKSPACE)).toBe("free");
    expect(mocks.revalidatePublicPage).not.toHaveBeenCalled();
    expect(logged().map((line) => line.outcome).sort()).toEqual(["bad_signature", "bad_signature", "missing_signature", "stale_timestamp"]);
  });

  it("refuses a body that is too large before verifying anything", async () => {
    const { fake } = setup();
    const verify = vi.spyOn(fake.adapter, "verifyWebhook");
    expect((await post("x".repeat(300 * 1024), "t=1,v1=" + "a".repeat(64))).status).toBe(400);
    expect((await post("{}", "t=1,v1=" + "a".repeat(64), { "content-length": String(10 * 1024 * 1024) })).status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
    expect(logged().every((line) => line.outcome === "too_large")).toBe(true);
  });

  it("answers 503 and changes nothing while billing is off", async () => {
    mocks.configuredSync.mockReturnValue(null);
    const response = await post("{}", "t=1,v1=" + "a".repeat(64));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ received: false });
    expect(logged().at(-1)).toMatchObject({ event: "billing.webhook", outcome: "billing_off" });
  });

  it("asks the provider to retry when something is unavailable", async () => {
    const { fake, ledger } = setup();
    const delivery = await paidCheckout(fake, ledger);
    ledger.setDown(true);
    expect((await post(delivery.rawBody, delivery.signatureHeader)).status).toBe(503);
    expect(ledger.planOf(WORKSPACE)).toBe("free");
    expect(logged().at(-1)).toMatchObject({ level: "error", outcome: "unavailable" });
  });

  it("logs the topic and the outcome, never the payload, a signature or a provider id", async () => {
    const { fake, ledger } = setup();
    const delivery = await paidCheckout(fake, ledger);
    await post(delivery.rawBody, delivery.signatureHeader, { "x-correlation-id": "abcdef12-3456" });
    const dispute = fake.dispute(delivery.event.subscriptionId as string);
    await post(dispute.rawBody, dispute.signatureHeader);
    const lines = logged().sort((a, b) => String(a.time).localeCompare(String(b.time)));
    expect(lines.find((line) => line.topic === "checkout")).toMatchObject({ event: "billing.webhook", outcome: "applied", topic: "checkout", planChanged: true, correlationId: "abcdef12-3456" });
    // A chargeback is always worth a human look.
    expect(lines.some((line) => line.topic === "dispute" && line.level !== "info")).toBe(true);
    const text = JSON.stringify(lines);
    for (const secret of [delivery.event.subscriptionId, delivery.event.customerId, delivery.event.id, delivery.signatureHeader, WORKSPACE, SIGNING_SECRET]) {
      expect(text).not.toContain(String(secret));
    }
    for (const line of lines) expect(Object.keys(line).sort()).toEqual(["correlationId", "durationMs", "event", "level", "outcome", "planChanged", "service", "time", "topic"]);
  });
});
