import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BILLING_COPY, HOME_COPY } from "@/content/pt-BR";
import { PRODUCT } from "@/lib/product";
import { planEntitlementsFromProduct } from "@/modules/entitlements";
import { WORKSPACE_ROLES } from "@/modules/identity/permissions";
import { customerRegistrationMessage, serializeBillingSnapshot, signBillingMessage } from "./attestation";
import { BILLING_INTERVALS, PAID_PLAN_IDS, PLAN_IDS, PRICE_CATALOG, formatMoney, isPaidPlan, planForCharge, planPrice, planRank, yearlySavingCents } from "./catalog";
import { downgradeImpact, hasImpact, type WorkspaceUsage } from "./downgrade-impact";
import { paidPlansAreOnSale } from "./marketing";
import { billingSecrets, resolveBillingMode } from "./mode";
import { billingBannerSentence, billingStateSentence, formatBillingDate, impactSentence, planFeatureLines, priceLabel, upgradeHref } from "./presentation";
import { billingErrorFromDatabase, pickCurrentSubscription, toInvoiceView, toSubscriptionRecord } from "./read";
import { checkoutIdempotencyKey, parseApplyOutcome, parseMaintenanceTick } from "./service";
import { GRACE_PERIOD_DAYS, availableBillingActions, billingViewState, graceDeadline, grantedPlan, transition, type SubscriptionObservation, type SubscriptionRecord } from "./subscription";
import { WEBHOOK_TOLERANCE_SECONDS, signWebhookPayload, verifyWebhookSignature } from "./webhook-signature";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));
const T0 = new Date("2026-10-09T12:00:00.000Z");
const days = (count: number, from: Date = T0) => new Date(from.getTime() + count * 86_400_000);

describe("price catalogue (AC1)", () => {
  it("shows R$ 14,90 or R$ 149 for Pro and R$ 57,90 or R$ 579 for Agency", () => {
    expect(formatMoney(planPrice("pro", "month")?.amountCents ?? 0)).toBe("R$ 14,90");
    expect(formatMoney(planPrice("pro", "year")?.amountCents ?? 0)).toBe("R$ 149,00");
    expect(formatMoney(planPrice("agency", "month")?.amountCents ?? 0)).toBe("R$ 57,90");
    expect(formatMoney(planPrice("agency", "year")?.amountCents ?? 0)).toBe("R$ 579,00");
    expect(priceLabel(1490, "month")).toBe("R$ 14,90 por mês");
    expect(priceLabel(57900, "year")).toBe("R$ 579,00 por ano");
  });

  it("is integer cents in BRL, one row per paid plan and interval, and nothing for the free plan", () => {
    expect(PRICE_CATALOG).toEqual([
      { planId: "pro", interval: "month", amountCents: 1490, currency: "BRL" },
      { planId: "pro", interval: "year", amountCents: 14900, currency: "BRL" },
      { planId: "agency", interval: "month", amountCents: 5790, currency: "BRL" },
      { planId: "agency", interval: "year", amountCents: 57900, currency: "BRL" },
    ]);
    expect(PAID_PLAN_IDS).toEqual(["pro", "agency"]);
    expect(isPaidPlan("free")).toBe(false);
    expect(planPrice("free", "month")).toBeNull();
    for (const price of PRICE_CATALOG) expect(Number.isInteger(price.amountCents)).toBe(true);
  });

  it("states the yearly saving in reais: about two months", () => {
    expect(formatMoney(yearlySavingCents("pro"))).toBe("R$ 29,80");
    expect(formatMoney(yearlySavingCents("agency"))).toBe("R$ 115,80");
    expect(yearlySavingCents("free")).toBe(0);
  });

  it("derives the plan from what is charged, and only from an exact catalogue price", () => {
    for (const price of PRICE_CATALOG) expect(planForCharge(price.amountCents, price.currency, price.interval)).toBe(price.planId);
    expect(planForCharge(1490, "brl", "month")).toBe("pro");
    // The cheap amount with the expensive plan's interval, another currency, or one cent off: nothing.
    expect(planForCharge(1490, "BRL", "year")).toBeNull();
    expect(planForCharge(5790, "USD", "month")).toBeNull();
    expect(planForCharge(5789, "BRL", "month")).toBeNull();
    expect(planForCharge(0, "BRL", "month")).toBeNull();
    expect(new Set(PRICE_CATALOG.map((price) => `${price.interval}:${price.amountCents}:${price.currency}`)).size).toBe(PRICE_CATALOG.length);
  });

  it("ranks plans by price without naming them", () => {
    expect(planRank("free")).toBe(0);
    expect(planRank("agency")).toBeGreaterThan(planRank("pro"));
  });

  it("matches the plan_prices seed in the migrations (drift guard)", () => {
    const sql = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).map((file) => readFileSync(MIGRATIONS_DIR + file, "utf8")).join("\n");
    const seeded = [...sql.matchAll(/\('([a-z_]+)', '(month|year)', (\d+), '([A-Z]{3})'\)/g)].map(([, planId, interval, amount, currency]) => ({ planId, interval, amountCents: Number(amount), currency }));
    const byKey = (rows: ReadonlyArray<{ planId?: string; interval?: string }>) => [...rows].sort((a, b) => `${a.planId}${a.interval}`.localeCompare(`${b.planId}${b.interval}`));
    expect(byKey(seeded)).toEqual(byKey(PRICE_CATALOG));
    expect(sql).toContain(`interval '${GRACE_PERIOD_DAYS} days'`);
  });
});

describe("subscription state machine (AC4)", () => {
  const observe = (overrides: Partial<SubscriptionObservation> = {}): SubscriptionObservation => ({ status: "active", planId: "agency", interval: "month", currentPeriodEnd: days(30), cancelAtPeriodEnd: false, ...overrides });
  const record = (overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({ ...observe(), graceUntil: null, heldPlanId: null, heldUntil: null, ...overrides });

  it("gives seven days of grace from the first failure", () => {
    expect(GRACE_PERIOD_DAYS).toBe(7);
    expect(graceDeadline(T0)).toEqual(days(7));
  });

  // current status -> observed status: every pair.
  const cases: Array<[string, SubscriptionRecord | null, SubscriptionObservation, Date, Partial<SubscriptionRecord>, string | null]> = [
    ["nothing -> incomplete (checkout done, first payment pending)", null, observe({ status: "incomplete" }), T0, { status: "incomplete", graceUntil: null }, null],
    ["nothing -> active (checkout paid)", null, observe(), T0, { status: "active", graceUntil: null }, "agency"],
    ["nothing -> past_due", null, observe({ status: "past_due" }), T0, { status: "past_due", graceUntil: days(7) }, "agency"],
    ["nothing -> ended", null, observe({ status: "ended" }), T0, { status: "ended" }, null],
    ["incomplete -> active (first payment confirmed)", record({ status: "incomplete" }), observe(), T0, { status: "active" }, "agency"],
    ["incomplete -> ended (never paid)", record({ status: "incomplete" }), observe({ status: "ended" }), T0, { status: "ended" }, null],
    ["incomplete -> incomplete", record({ status: "incomplete" }), observe({ status: "incomplete" }), T0, { status: "incomplete" }, null],
    ["incomplete -> past_due", record({ status: "incomplete" }), observe({ status: "past_due" }), T0, { status: "past_due", graceUntil: days(7) }, "agency"],
    ["active -> active (renewal: only the period moves)", record(), observe({ currentPeriodEnd: days(60) }), days(30), { status: "active", currentPeriodEnd: days(60) }, "agency"],
    ["active -> active with cancellation scheduled", record(), observe({ cancelAtPeriodEnd: true }), T0, { status: "active", cancelAtPeriodEnd: true }, "agency"],
    ["active -> past_due (payment failed): grace starts", record(), observe({ status: "past_due" }), days(1), { status: "past_due", graceUntil: days(8) }, "agency"],
    ["active -> ended (cancelled at period end, deleted, chargeback)", record(), observe({ status: "ended" }), T0, { status: "ended", graceUntil: null }, null],
    ["active -> incomplete is stored as observed and grants nothing", record(), observe({ status: "incomplete" }), T0, { status: "incomplete" }, null],
    ["past_due -> past_due (another failed attempt): grace is not restarted", record({ status: "past_due", graceUntil: days(8) }), observe({ status: "past_due" }), days(5), { status: "past_due", graceUntil: days(8) }, "agency"],
    ["past_due -> active (recovered inside the period)", record({ status: "past_due", graceUntil: days(8) }), observe(), days(5), { status: "active", graceUntil: null }, "agency"],
    ["past_due -> active (recovered after the period)", record({ status: "past_due", graceUntil: days(8) }), observe(), days(20), { status: "active", graceUntil: null }, "agency"],
    ["past_due -> ended (the provider gave up)", record({ status: "past_due", graceUntil: days(8) }), observe({ status: "ended" }), days(9), { status: "ended", graceUntil: null }, null],
    ["past_due -> incomplete", record({ status: "past_due", graceUntil: days(8) }), observe({ status: "incomplete" }), days(2), { status: "incomplete", graceUntil: null }, null],
    ["ended -> active: ended is terminal", record({ status: "ended" }), observe(), T0, { status: "ended" }, null],
    ["ended -> past_due: ended is terminal", record({ status: "ended" }), observe({ status: "past_due" }), T0, { status: "ended", graceUntil: null }, null],
    ["ended -> incomplete: ended is terminal", record({ status: "ended" }), observe({ status: "incomplete" }), T0, { status: "ended" }, null],
    ["ended -> ended", record({ status: "ended" }), observe({ status: "ended" }), T0, { status: "ended" }, null],
  ];
  it.each(cases)("%s", (_name, current, observed, now, expected, granted) => {
    const next = transition(current, observed, now);
    expect(next).toMatchObject(expected);
    expect(grantedPlan(next, now)).toBe(granted);
  });

  it("holds the paid plan during grace and loses it at the deadline, to the instant", () => {
    const failing = transition(record(), observe({ status: "past_due" }), T0);
    expect(grantedPlan(failing, days(6))).toBe("agency");
    expect(grantedPlan(failing, new Date(days(7).getTime() - 1))).toBe("agency");
    expect(grantedPlan(failing, days(7))).toBeNull();
    expect(grantedPlan(failing, days(30))).toBeNull();
  });

  it("starts a new grace period for a new failure after a recovery", () => {
    const first = transition(record(), observe({ status: "past_due" }), T0);
    const recovered = transition(first, observe(), days(3));
    const second = transition(recovered, observe({ status: "past_due" }), days(40));
    expect(second.graceUntil).toEqual(days(47));
  });

  it("keeps the plan already paid for after a paid-to-paid downgrade, until the paid period ends", () => {
    const downgraded = transition(record({ currentPeriodEnd: days(20) }), observe({ planId: "pro", currentPeriodEnd: days(20) }), days(5));
    expect(downgraded).toMatchObject({ planId: "pro", heldPlanId: "agency", heldUntil: days(20) });
    expect(grantedPlan(downgraded, days(19))).toBe("agency");
    expect(grantedPlan(downgraded, days(20))).toBe("pro");
    // Another observation inside the period keeps the hold; upgrading back clears it.
    expect(transition(downgraded, observe({ planId: "pro", currentPeriodEnd: days(20) }), days(6))).toMatchObject({ heldPlanId: "agency", heldUntil: days(20) });
    expect(transition(downgraded, observe({ planId: "agency", currentPeriodEnd: days(20) }), days(6))).toMatchObject({ planId: "agency", heldPlanId: null, heldUntil: null });
    // After the period the hold is gone and the cheaper plan is what a later renewal keeps.
    expect(transition(downgraded, observe({ planId: "pro", currentPeriodEnd: days(50) }), days(21))).toMatchObject({ planId: "pro", heldPlanId: null });
  });

  it("applies an upgrade at once and never holds on a cancellation or an end", () => {
    expect(transition(record({ planId: "pro" }), observe({ planId: "agency" }), T0)).toMatchObject({ planId: "agency", heldPlanId: null });
    expect(grantedPlan(transition(record(), observe({ status: "ended" }), T0), T0)).toBeNull();
    expect(grantedPlan(transition(record({ heldPlanId: "agency", heldUntil: days(20), planId: "pro" }), observe({ planId: "pro", status: "ended" }), days(1)), days(1))).toBeNull();
  });

  it("grants nothing without a subscription", () => {
    expect(grantedPlan(null, T0)).toBeNull();
  });
});

describe("user-facing billing state", () => {
  const base: SubscriptionRecord = { status: "active", planId: "agency", interval: "month", currentPeriodEnd: days(30), cancelAtPeriodEnd: false, graceUntil: null, heldPlanId: null, heldUntil: null };
  const states: Array<[string, SubscriptionRecord | null, "free" | "pro" | "agency", string]> = [
    ["no subscription, free plan", null, "free", "free"],
    ["no subscription, a plan set by hand", null, "agency", "manual"],
    ["first payment pending", { ...base, status: "incomplete" }, "free", "incomplete"],
    ["active", base, "agency", "active"],
    ["cancelled, still inside the paid period", { ...base, cancelAtPeriodEnd: true }, "agency", "canceling"],
    ["cheaper plan scheduled", { ...base, planId: "pro", heldPlanId: "agency", heldUntil: days(10) }, "agency", "downgrading"],
    ["payment failing, inside grace", { ...base, status: "past_due", graceUntil: days(5) }, "agency", "past_due"],
    ["payment failing, grace over", { ...base, status: "past_due", graceUntil: days(-1) }, "free", "grace_expired"],
    ["ended", { ...base, status: "ended" }, "free", "ended"],
    ["ended, but a plan was set by hand afterwards", { ...base, status: "ended" }, "agency", "manual"],
  ];
  it.each(states)("%s", (_name, record, planId, kind) => {
    const state = billingViewState(record, planId, T0);
    expect(state.kind).toBe(kind);
    // Every state has words of its own, with the plan named.
    expect(billingStateSentence(state, 5790).length).toBeGreaterThan(20);
    expect(BILLING_COPY.statusLabel[state.kind]).toBeTruthy();
  });

  it("says the state and the date in words", () => {
    expect(billingStateSentence(billingViewState(base, "agency", T0), 5790)).toBe("Plano Agência, cobrança mensal. Próxima cobrança: R$ 57,90 em 08/11/2026.");
    expect(billingStateSentence(billingViewState({ ...base, status: "past_due", graceUntil: days(5) }, "agency", T0), 5790)).toContain("continua valendo até 14/10/2026");
    expect(billingStateSentence(billingViewState({ ...base, cancelAtPeriodEnd: true }, "agency", T0), 5790)).toContain("até 08/11/2026");
    expect(billingStateSentence(billingViewState(null, "agency", T0), null)).toContain("definido manualmente");
    expect(formatBillingDate(null)).toBe("");
    expect(formatBillingDate("not a date")).toBe("");
  });

  it("shows the banner only while a payment is failing", () => {
    expect(billingBannerSentence(billingViewState({ ...base, status: "past_due", graceUntil: days(5) }, "agency", T0))).toBe("O último pagamento do plano Agência falhou. O plano continua valendo até 14/10/2026.");
    expect(billingBannerSentence(billingViewState({ ...base, status: "past_due", graceUntil: days(-1) }, "free", T0))).toContain("suspenso por falta de pagamento");
    for (const record of [null, base, { ...base, cancelAtPeriodEnd: true }, { ...base, status: "ended" as const }, { ...base, status: "incomplete" as const }]) {
      expect(billingBannerSentence(billingViewState(record, "free", T0))).toBeNull();
    }
  });

  it("offers each action only in the states where it makes sense", () => {
    const actions = (record: SubscriptionRecord | null, planId: "free" | "agency" = "agency") => availableBillingActions(billingViewState(record, planId, T0));
    expect(actions(null, "free")).toMatchObject({ subscribe: true, cancel: false, changePlan: false });
    expect(actions(null, "agency")).toMatchObject({ subscribe: true });
    expect(actions(base)).toMatchObject({ subscribe: false, cancel: true, changePlan: true, resume: false });
    expect(actions({ ...base, cancelAtPeriodEnd: true })).toMatchObject({ subscribe: false, cancel: false, resume: true, changePlan: false });
    expect(actions({ ...base, status: "past_due", graceUntil: days(5) })).toMatchObject({ fixPayment: true, cancel: true, subscribe: false, changePlan: false });
    expect(actions({ ...base, status: "incomplete" }, "free")).toMatchObject({ fixPayment: true, subscribe: false });
    expect(actions({ ...base, status: "ended" }, "free")).toMatchObject({ subscribe: true });
  });
});

describe("downgrade impact (AC3)", () => {
  const usage = (overrides: Partial<WorkspaceUsage> = {}): WorkspaceUsage => ({ pages: 3, members: 2, pendingInvitations: 0, activeReportLinks: 1, storageBytes: 40 * 1024 * 1024, ...overrides });
  const agency = planEntitlementsFromProduct("agency");
  const pro = planEntitlementsFromProduct("pro");
  const free = planEntitlementsFromProduct("free");
  const kinds = (items: ReturnType<typeof downgradeImpact>) => Object.fromEntries(items.map((item) => [item.key, item.kind]));

  it("Agency to Pro with 3 pages, 2 members and an active report link", () => {
    const items = downgradeImpact(usage(), agency, pro);
    expect(kinds(items)).toEqual({ max_profiles: "blocked", team_members: "blocked", storage_mb: "kept", analytics_days: "kept", shareable_reports: "stops", remove_badge: "kept" });
    expect(items.find((item) => item.key === "max_profiles")).toMatchObject({ used: 3, limit: 1, over: 2 });
    expect(items.find((item) => item.key === "team_members")).toMatchObject({ used: 2, limit: 1, over: 1 });
    expect(hasImpact(items)).toBe(true);
    expect(impactSentence(items[0] as (typeof items)[number])).toBe("2 de 3 páginas ficam acima do limite de 1. Todas continuam no ar e editáveis; só não será possível criar ou duplicar páginas enquanto a conta estiver acima do limite.");
  });

  const table: Array<[string, WorkspaceUsage, typeof agency, typeof agency, Record<string, string>]> = [
    ["Agency to Free: history, reports and the badge stop too", usage(), agency, free, { max_profiles: "blocked", team_members: "blocked", storage_mb: "blocked", analytics_days: "stops", shareable_reports: "stops", remove_badge: "stops" }],
    ["Pro to Free with one page and little storage", usage({ pages: 1, members: 1, storageBytes: 5 * 1024 * 1024, activeReportLinks: 0 }), pro, free, { max_profiles: "kept", team_members: "kept", storage_mb: "kept", analytics_days: "stops", remove_badge: "stops" }],
    ["Agency to Pro when everything already fits", usage({ pages: 1, members: 1, activeReportLinks: 0 }), agency, pro, { max_profiles: "kept", team_members: "kept", storage_mb: "kept", analytics_days: "kept", shareable_reports: "stops", remove_badge: "kept" }],
    ["pending invitations hold seats", usage({ pages: 1, members: 1, pendingInvitations: 2 }), agency, pro, { max_profiles: "kept", team_members: "blocked", storage_mb: "kept", analytics_days: "kept", shareable_reports: "stops", remove_badge: "kept" }],
    ["storage exactly at the limit is kept", usage({ pages: 1, members: 1, storageBytes: 100 * 1024 * 1024 }), agency, pro, { max_profiles: "kept", team_members: "kept", storage_mb: "kept", analytics_days: "kept", shareable_reports: "stops", remove_badge: "kept" }],
    ["one byte above the limit is blocked", usage({ pages: 1, members: 1, storageBytes: 100 * 1024 * 1024 + 1 }), agency, pro, { max_profiles: "kept", team_members: "kept", storage_mb: "blocked", analytics_days: "kept", shareable_reports: "stops", remove_badge: "kept" }],
    ["the same plan changes nothing", usage(), agency, agency, { max_profiles: "kept", team_members: "kept", storage_mb: "kept", analytics_days: "kept", shareable_reports: "kept", remove_badge: "kept" }],
  ];
  it.each(table)("%s", (_name, current, from, to, expected) => {
    expect(kinds(downgradeImpact(current, from, to))).toEqual(expected);
  });

  it("writes every line with the workspace's real numbers and never promises a deletion", () => {
    for (const [, current, from, to] of table) {
      for (const item of downgradeImpact(current, from, to)) {
        const sentence = impactSentence(item);
        expect(sentence.length).toBeGreaterThan(15);
        expect(sentence).not.toMatch(/apagad[oa]s?\b(?! e volta)|exclu[ií]d|removid/);
      }
    }
    expect(impactSentence({ key: "shareable_reports", kind: "stops", activeLinks: 1 })).toContain("1 link de relatório ativo deixa de abrir");
    expect(impactSentence({ key: "team_members", kind: "blocked", used: 3, members: 2, pendingInvitations: 1, limit: 1, over: 2 })).toContain("2 pessoas e 1 convite pendente");
    expect(hasImpact(downgradeImpact(usage(), agency, agency))).toBe(false);
  });
});

describe("plan features are generated from the entitlements (AC5)", () => {
  it("lists what each plan includes", () => {
    expect(planFeatureLines("free")).toEqual(["1 página", "Só você na conta", "Resultados dos últimos 7 dias", "20 MB para imagens", "Selo do produto no rodapé das páginas", "Sem link de relatório para o cliente"]);
    expect(planFeatureLines("pro")).toEqual(["1 página", "Só você na conta", "Resultados dos últimos 90 dias", "100 MB para imagens", "Páginas e relatórios sem o selo do produto", "Sem link de relatório para o cliente"]);
    expect(planFeatureLines("agency")).toEqual(["10 páginas", "Equipe de até 5 pessoas", "Resultados dos últimos 90 dias", "500 MB para imagens", "Páginas e relatórios sem o selo do produto", "Link de relatório para o cliente"]);
  });

  it("follows product.ts: every plan has a name and a description", () => {
    for (const planId of PLAN_IDS) {
      expect(BILLING_COPY.planNames[planId]).toBeTruthy();
      expect(BILLING_COPY.planDescriptions[planId]).toBeTruthy();
      expect(Object.keys(PRODUCT.plans)).toContain(planId);
    }
    for (const interval of BILLING_INTERVALS) expect(BILLING_COPY.perInterval[interval]).toBeTruthy();
  });
});

describe("billing mode", () => {
  const sandbox = { BILLING_MODE: "sandbox", STRIPE_SECRET_KEY: "sk_test_" + "a".repeat(24), STRIPE_WEBHOOK_SECRET: "whsec_" + "b".repeat(24), BILLING_SIGNING_SECRET: "c".repeat(64), NEXT_PUBLIC_APP_URL: "https://exemplo.test" };
  const live = { ...sandbox, BILLING_MODE: "live", STRIPE_SECRET_KEY: "sk_live_" + "a".repeat(24) };

  const table: Array<[string, Record<string, string | undefined>, string, string]> = [
    ["nothing set", {}, "off", "disabled"],
    ["explicitly off, even with every secret", { ...sandbox, BILLING_MODE: "off" }, "off", "disabled"],
    ["an unknown mode", { ...sandbox, BILLING_MODE: "production" }, "off", "unknown_mode"],
    ["sandbox with a test key", sandbox, "sandbox", "ok"],
    ["sandbox with a restricted test key", { ...sandbox, STRIPE_SECRET_KEY: "rk_test_" + "a".repeat(24) }, "sandbox", "ok"],
    ["sandbox with a LIVE key: never charge real money in a test environment", { ...sandbox, STRIPE_SECRET_KEY: live.STRIPE_SECRET_KEY }, "off", "key_mode_mismatch"],
    ["live with a TEST key: never present a test checkout as a real offer", { ...live, STRIPE_SECRET_KEY: sandbox.STRIPE_SECRET_KEY }, "off", "key_mode_mismatch"],
    ["live with a live key", live, "live", "ok"],
    ["no provider key", { ...sandbox, STRIPE_SECRET_KEY: undefined }, "off", "missing_provider_key"],
    ["no webhook secret", { ...sandbox, STRIPE_WEBHOOK_SECRET: undefined }, "off", "missing_webhook_secret"],
    ["a webhook secret that is not one", { ...sandbox, STRIPE_WEBHOOK_SECRET: "x".repeat(40) }, "off", "missing_webhook_secret"],
    ["no signing secret", { ...sandbox, BILLING_SIGNING_SECRET: undefined }, "off", "missing_signing_secret"],
    ["a short signing secret", { ...sandbox, BILLING_SIGNING_SECRET: "short" }, "off", "missing_signing_secret"],
    ["sandbox against the local emulator", { ...sandbox, STRIPE_API_BASE_URL: "http://127.0.0.1:4242" }, "sandbox", "ok"],
    ["sandbox pointed at another host", { ...sandbox, STRIPE_API_BASE_URL: "https://evil.example" }, "off", "base_url_not_allowed"],
    ["live can never be pointed away from the provider", { ...live, STRIPE_API_BASE_URL: "http://127.0.0.1:4242" }, "off", "base_url_not_allowed"],
    ["live needs an https application address", { ...live, NEXT_PUBLIC_APP_URL: "http://exemplo.test" }, "off", "insecure_app_url"],
  ];
  it.each(table)("%s", (_name, env, mode, reason) => {
    expect(resolveBillingMode(env)).toEqual({ mode, reason });
    expect(billingSecrets(env) === null).toBe(mode === "off");
  });

  it("offers the plans link only to who can buy, and only when plans are for sale", () => {
    for (const role of WORKSPACE_ROLES) {
      expect(upgradeHref("off", role, "w1")).toBeNull();
      expect(upgradeHref("sandbox", role, "w1")).toBe(role === "owner" ? "/app/w/w1/plano" : null);
      expect(upgradeHref("live", role, "w1")).toBe(role === "owner" ? "/app/w/w1/plano" : null);
    }
    expect(upgradeHref("live", null, "w1")).toBeNull();
  });
});

describe("marketing (D6)", () => {
  it("offers paid plans on the public home only with live billing", () => {
    expect(paidPlansAreOnSale("off")).toBe(false);
    expect(paidPlansAreOnSale("sandbox")).toBe(false);
    expect(paidPlansAreOnSale("live")).toBe(true);
  });

  it("keeps the not-for-sale copy free of prices and the for-sale copy free of 'em breve'", () => {
    const plans = HOME_COPY.plans;
    expect(plans.lead).toContain("ainda não estão à venda");
    expect(plans.lead).not.toMatch(/R\$|preço/);
    expect(plans.leadSelling).not.toContain("em breve");
    expect(plans.perMonth(formatMoney(1490))).toBe("R$ 14,90 por mês");
    expect(plans.orPerYear(formatMoney(14900))).toBe("ou R$ 149,00 por ano");
    for (const entry of HOME_COPY.faq.items) {
      if ("answerSelling" in entry) expect(entry.answerSelling).not.toContain("ainda não");
    }
  });
});

describe("attestation", () => {
  // Same secret and vector as supabase/tests/database/170-billing.test.sql (drift guard).
  const SECRET = "test-billing-signing-secret-0123456789";

  it("signs the customer binding exactly as the database verifies it", () => {
    const message = customerRegistrationMessage("00000000-0000-4000-8000-000000000001", "stripe", "cus_vector");
    expect(message).toBe("lnk-billing-customer:v1:00000000-0000-4000-8000-000000000001:stripe:cus_vector");
    expect(signBillingMessage(message, SECRET)).toBe("ac15564a4a10b6497050816d307b51ba7775c0856e7564f1c7845d33b46baa4a");
  });

  it("serializes a snapshot with a fixed key order and nothing but what the database reads", () => {
    const text = serializeBillingSnapshot({
      provider: "stripe", eventId: "evt_1", reason: "webhook", observedAt: T0, customerId: "cus_1",
      subscription: { id: "sub_1", customerId: "cus_1", workspaceId: "00000000-0000-4000-8000-000000000001", status: "active", amountCents: 1490, currency: "brl", interval: "month", currentPeriodEnd: days(30), cancelAtPeriodEnd: false },
      invoices: [{ id: "in_1", amountCents: 1490, currency: "brl", status: "paid", paidAt: T0, createdAt: T0, receiptUrl: "https://pay.example.test/in_1" }],
    });
    expect(text).toBe(
      '{"v":1,"provider":"stripe","event_id":"evt_1","reason":"webhook","observed_at":"2026-10-09T12:00:00.000Z","customer_id":"cus_1",'
      + '"subscription":{"id":"sub_1","customer_id":"cus_1","workspace_id":"00000000-0000-4000-8000-000000000001","status":"active","amount_cents":1490,"currency":"BRL","interval":"month","current_period_end":"2026-11-08T12:00:00.000Z","cancel_at_period_end":false},'
      + '"invoices":[{"id":"in_1","amount_cents":1490,"currency":"BRL","status":"paid","paid_at":"2026-10-09T12:00:00.000Z","created_at":"2026-10-09T12:00:00.000Z","receipt_url":"https://pay.example.test/in_1"}]}',
    );
  });

  it("bounds the invoices and writes a missing subscription as null", () => {
    const invoice = { id: "in_x", amountCents: 1, currency: "BRL", status: "paid" as const, paidAt: null, createdAt: T0, receiptUrl: null };
    const parsed = JSON.parse(serializeBillingSnapshot({ provider: "stripe", eventId: "e", reason: "reconciliation", observedAt: T0, customerId: "cus_1", subscription: null, invoices: Array.from({ length: 30 }, () => invoice) })) as { subscription: unknown; invoices: unknown[] };
    expect(parsed.subscription).toBeNull();
    expect(parsed.invoices).toHaveLength(12);
  });
});

describe("webhook signature", () => {
  const SECRET = "whsec_" + "s".repeat(32);
  const body = '{"id":"evt_1","type":"invoice.paid"}';

  it("accepts a signature made now with the endpoint secret", () => {
    expect(verifyWebhookSignature(body, signWebhookPayload(body, SECRET, T0), SECRET, T0)).toBeNull();
    // While a secret is rolled the provider sends one signature per secret.
    expect(verifyWebhookSignature(body, `${signWebhookPayload(body, "whsec_old", T0)},${signWebhookPayload(body, SECRET, T0).split(",")[1]}`, SECRET, T0)).toBeNull();
  });

  const refused: Array<[string, string | null, Date, string]> = [
    ["no header", null, T0, "missing_signature"],
    ["an empty header", "", T0, "missing_signature"],
    ["a header without a v1 signature", `t=${Math.floor(T0.getTime() / 1000)},v0=${"a".repeat(64)}`, T0, "missing_signature"],
    ["a header without a timestamp", `v1=${"a".repeat(64)}`, T0, "missing_signature"],
    ["a signature made with another secret", signWebhookPayload(body, "whsec_other_secret_000000000000000", T0), T0, "bad_signature"],
    ["a signature of another body", signWebhookPayload(body + " ", SECRET, T0), T0, "bad_signature"],
    ["a valid signature with the timestamp moved", signWebhookPayload(body, SECRET, T0).replace(/t=\d+/, `t=${Math.floor(T0.getTime() / 1000) + 1}`), T0, "bad_signature"],
    ["a valid signature that is too old (replay)", signWebhookPayload(body, SECRET, T0), new Date(T0.getTime() + (WEBHOOK_TOLERANCE_SECONDS + 1) * 1000), "stale_timestamp"],
    ["a valid signature from the future", signWebhookPayload(body, SECRET, new Date(T0.getTime() + (WEBHOOK_TOLERANCE_SECONDS + 2) * 1000)), T0, "stale_timestamp"],
    ["a very long header", "t=1," + "v1=a,".repeat(400), T0, "missing_signature"],
  ];
  it.each(refused)("refuses %s", (_name, header, now, reason) => {
    expect(verifyWebhookSignature(body, header, SECRET, now)).toBe(reason);
  });

  it("accepts a timestamp at the edge of the tolerance", () => {
    expect(verifyWebhookSignature(body, signWebhookPayload(body, SECRET, T0), SECRET, new Date(T0.getTime() + WEBHOOK_TOLERANCE_SECONDS * 1000))).toBeNull();
  });
});

describe("reads and parsing", () => {
  it("maps the database error contract", () => {
    expect(billingErrorFromDatabase({ code: "42501" })).toBe("forbidden");
    expect(billingErrorFromDatabase({ code: "P0002" })).toBe("not_found");
    expect(billingErrorFromDatabase({ code: "22023" })).toBe("invalid_plan");
    expect(billingErrorFromDatabase({ code: "LK100" })).toBe("already_subscribed");
    expect(billingErrorFromDatabase({ code: "LK101" })).toBe("rate_limited");
    expect(billingErrorFromDatabase({ code: "LK103", details: "none" })).toBe("no_subscription");
    expect(billingErrorFromDatabase({ code: "LK103", details: "same" })).toBe("same_plan");
    expect(billingErrorFromDatabase({ code: "LK103", details: "state" })).toBe("invalid_state");
    expect(billingErrorFromDatabase({ code: "LK060", details: "not_configured" })).toBe("not_configured");
    expect(billingErrorFromDatabase({ code: "LK060" })).toBe("unavailable");
    // Before the migration: the function or the table does not exist.
    expect(billingErrorFromDatabase({ code: "PGRST202" })).toBe("not_deployed");
    expect(billingErrorFromDatabase({ code: "42P01" })).toBe("not_deployed");
    expect(billingErrorFromDatabase({ code: "08006" })).toBe("unavailable");
    for (const kind of ["forbidden", "not_found", "invalid_plan", "already_subscribed", "rate_limited", "no_subscription", "same_plan", "invalid_state", "not_configured", "not_deployed", "unavailable", "billing_off", "provider_unavailable", "provider_rejected", "unauthenticated"] as const) {
      expect(BILLING_COPY.errors[kind]).toBeTruthy();
    }
  });

  it("reads a stored subscription tolerantly", () => {
    const row = { plan_id: "agency", billing_interval: "year", amount_cents: 57900, status: "active", current_period_end: "2027-10-09T12:00:00Z", cancel_at_period_end: false, grace_until: null, held_plan_id: null, held_until: null, created_at: "2026-10-09T12:00:00Z" };
    expect(toSubscriptionRecord(row)).toMatchObject({ status: "active", planId: "agency", interval: "year", cancelAtPeriodEnd: false, heldPlanId: null });
    expect(toSubscriptionRecord({ ...row, status: "trialing" })).toBeNull();
    expect(toSubscriptionRecord({ ...row, plan_id: "enterprise" })).toBeNull();
    expect(toSubscriptionRecord({ ...row, held_plan_id: "enterprise", held_until: "2027-01-01T00:00:00Z" })).toMatchObject({ heldPlanId: null, heldUntil: null });
  });

  it("picks the paying subscription, otherwise the most recent", () => {
    const row = (status: string, created_at: string) => ({ status, created_at });
    expect(pickCurrentSubscription([])).toBeNull();
    expect(pickCurrentSubscription([row("ended", "2026-01-02"), row("active", "2026-01-01")])).toMatchObject({ status: "active" });
    expect(pickCurrentSubscription([row("ended", "2026-01-01"), row("incomplete", "2026-01-03"), row("ended", "2026-01-02")])).toMatchObject({ status: "incomplete" });
  });

  it("renders a receipt link only for an https address", () => {
    const invoice = { id: "1", amount_cents: 1490, status: "paid", issued_at: "2026-10-09T12:00:00Z", paid_at: "2026-10-09T12:00:00Z", receipt_url: "https://pay.example.test/in_1" };
    expect(toInvoiceView(invoice)?.receiptUrl).toBe("https://pay.example.test/in_1");
    expect(toInvoiceView({ ...invoice, receipt_url: "javascript:alert(1)" })?.receiptUrl).toBeNull();
    expect(toInvoiceView({ ...invoice, receipt_url: "http://pay.example.test/in_1" })?.receiptUrl).toBeNull();
    expect(toInvoiceView({ ...invoice, status: "draft" })).toBeNull();
  });

  it("fails closed on an answer it does not understand", () => {
    expect(parseApplyOutcome(null)).toEqual({ status: "invalid", planChanged: false, slugs: [] });
    expect(parseApplyOutcome({ status: "granted", plan_changed: "yes", slugs: "ana" })).toEqual({ status: "invalid", planChanged: false, slugs: [] });
    expect(parseApplyOutcome({ status: "applied", plan_changed: true, slugs: ["ana-lima", "../admin", 7, "cafe-ipe"] })).toEqual({ status: "applied", planChanged: true, slugs: ["ana-lima", "cafe-ipe"] });
    expect(parseMaintenanceTick({ grace_expired: 1, holds_released: 2, plan_changes: 3, purged_events: 4, pending: 5, slugs: ["ana-lima"], candidates: [{ subscription_id: "sub_1", customer_id: "cus_1" }, { subscription_id: 3 }, { subscription_id: null, customer_id: "cus_2" }] }))
      .toEqual({ graceExpired: 1, holdsReleased: 2, planChanges: 3, purgedEvents: 4, pending: 5, slugs: ["ana-lima"], candidates: [{ subscriptionId: "sub_1", customerId: "cus_1" }, { subscriptionId: null, customerId: "cus_2" }] });
    expect(parseMaintenanceTick("nope")).toMatchObject({ graceExpired: 0, candidates: [] });
  });

  it("gives the same checkout key inside ten minutes and another one after, per workspace, plan and interval", () => {
    const key = checkoutIdempotencyKey("w1", "pro", "month", new Date("2026-10-09T12:00:00Z"));
    expect(checkoutIdempotencyKey("w1", "pro", "month", new Date("2026-10-09T12:09:59Z"))).toBe(key);
    expect(checkoutIdempotencyKey("w1", "pro", "month", new Date("2026-10-09T12:10:00Z"))).not.toBe(key);
    expect(checkoutIdempotencyKey("w2", "pro", "month", new Date("2026-10-09T12:00:00Z"))).not.toBe(key);
    expect(checkoutIdempotencyKey("w1", "agency", "month", new Date("2026-10-09T12:00:00Z"))).not.toBe(key);
    expect(checkoutIdempotencyKey("w1", "pro", "year", new Date("2026-10-09T12:00:00Z"))).not.toBe(key);
    // A workspace that has had a subscription gets a new checkout, even inside the same ten minutes.
    expect(checkoutIdempotencyKey("w1", "pro", "month", new Date("2026-10-09T12:00:00Z"), 1)).not.toBe(key);
    expect(checkoutIdempotencyKey("w1", "pro", "month", new Date("2026-10-09T12:00:00Z"), 0)).toBe(key);
    expect(key).toMatch(/^lnk-co-[0-9a-f]{40}$/);
  });
});
