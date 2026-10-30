import { describe, expect, it } from "vitest";
import type { PlanId } from "@/lib/product";
import type { WorkspaceUsage } from "./downgrade-impact";
import type { BillingMode } from "./mode";
import { planScreen, type PlanScreenInput } from "./plan-screen";
import type { WorkspaceBilling } from "./read";
import type { SubscriptionRecord } from "./subscription";

const T0 = new Date("2026-10-09T15:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const days = (count: number) => new Date(T0.getTime() + count * DAY_MS);
const base: SubscriptionRecord = { status: "active", planId: "pro", interval: "month", currentPeriodEnd: days(30), cancelAtPeriodEnd: false, graceUntil: null, heldPlanId: null, heldUntil: null };

function input(record: SubscriptionRecord | null, planId: PlanId, overrides: Partial<Omit<PlanScreenInput, "billing">> & { amountCents?: number | null; deployed?: boolean } = {}): PlanScreenInput {
  const { amountCents = record ? 1490 : null, deployed = true, ...rest } = overrides;
  const billing: WorkspaceBilling = { deployed, planId, record, amountCents, invoices: [] };
  return { billing, mode: "sandbox" as BillingMode, isOwner: true, suspended: false, now: T0, usage: null, ...rest };
}

describe("plan screen: what the current plan says", () => {
  it("sums up a running subscription as its amount and next charge", () => {
    const screen = planScreen(input(base, "pro"));
    expect(screen.currentPlan).toBe("pro");
    expect(screen.summary).toEqual({
      kind: "facts",
      facts: [
        { key: "amount", label: "Valor", value: "R$\u00a014,90 por mês" },
        { key: "nextCharge", label: "Próxima cobrança", value: "08/11/2026", dateTime: "2026-11-08T15:00:00.000Z" },
      ],
    });
  });

  it("keeps the sentence when a running subscription has neither amount nor date", () => {
    const screen = planScreen(input({ ...base, currentPeriodEnd: null }, "pro", { amountCents: null }));
    expect(screen.summary).toEqual({ kind: "sentence", text: "Plano Pro, cobrança mensal.", tone: "neutral" });
  });

  it.each([
    ["first payment pending", { ...base, status: "incomplete" as const }, "free" as PlanId, "warning"],
    ["payment failing, inside grace", { ...base, status: "past_due" as const, graceUntil: days(5) }, "pro" as PlanId, "danger"],
    ["payment failing, grace over", { ...base, status: "past_due" as const, graceUntil: days(-1) }, "free" as PlanId, "danger"],
    ["cancelled, still paid", { ...base, cancelAtPeriodEnd: true }, "pro" as PlanId, "neutral"],
    ["cheaper plan scheduled", { ...base, heldPlanId: "agency" as PlanId, heldUntil: days(10) }, "agency" as PlanId, "neutral"],
    ["ended", { ...base, status: "ended" as const }, "free" as PlanId, "neutral"],
  ])("%s: says it in its sentence, toned when there is something to fix", (_name, record, planId, tone) => {
    const { summary } = planScreen(input(record, planId));
    expect(summary.kind).toBe("sentence");
    expect(summary.kind === "sentence" && summary.tone).toBe(tone);
  });

  it("names the date to fix a failing payment by", () => {
    const { summary } = planScreen(input({ ...base, status: "past_due", graceUntil: days(5) }, "pro"));
    expect(summary.kind === "sentence" && summary.text).toContain("continua valendo até 14/10/2026");
  });

  it("shows the plan in force: the plan already paid for during a scheduled downgrade, free after the end", () => {
    expect(planScreen(input({ ...base, heldPlanId: "agency", heldUntil: days(10) }, "agency")).currentPlan).toBe("agency");
    expect(planScreen(input({ ...base, status: "ended" }, "free")).currentPlan).toBe("free");
    expect(planScreen(input(null, "agency")).currentPlan).toBe("agency");
  });
});

describe("plan screen: commands for the owner", () => {
  const owner = (record: SubscriptionRecord | null, planId: PlanId) => planScreen(input(record, planId)).commands;

  it("offers the one fix while a payment is failing, with cancel apart and no second payment button", () => {
    expect(owner({ ...base, status: "past_due", graceUntil: days(5) }, "pro")).toEqual({ fixPayment: true, resume: false, managePayment: false, cancel: true });
    expect(owner({ ...base, status: "past_due", graceUntil: days(-1) }, "free")).toEqual({ fixPayment: true, resume: false, managePayment: false, cancel: true });
    expect(owner({ ...base, status: "incomplete" }, "free")).toEqual({ fixPayment: true, resume: false, managePayment: false, cancel: false });
  });

  it("offers payment details and cancel to a subscription in good standing, and only resume after a cancellation", () => {
    expect(owner(base, "pro")).toEqual({ fixPayment: false, resume: false, managePayment: true, cancel: true });
    expect(owner({ ...base, heldPlanId: "agency", heldUntil: days(10) }, "agency")).toEqual({ fixPayment: false, resume: false, managePayment: true, cancel: true });
    expect(owner({ ...base, cancelAtPeriodEnd: true }, "pro")).toEqual({ fixPayment: false, resume: true, managePayment: false, cancel: false });
  });

  it("has nothing to command without a subscription", () => {
    for (const [record, planId] of [[null, "free"], [null, "agency"], [{ ...base, status: "ended" as const }, "free"]] as const) {
      expect(owner(record, planId)).toEqual({ fixPayment: false, resume: false, managePayment: false, cancel: false });
    }
  });

  it("offers no command while plans are not for sale or before the migration", () => {
    const off = planScreen(input(base, "pro", { mode: "off" }));
    expect(off.selling).toBe(false);
    expect(off.commands).toEqual({ fixPayment: false, resume: false, managePayment: false, cancel: false });
    expect(planScreen(input(base, "pro", { deployed: false })).selling).toBe(false);
  });

  it("keeps fixing and cancelling for a suspended workspace, and nothing that buys", () => {
    const screen = planScreen(input(base, "pro", { suspended: true }));
    expect(screen.commands).toEqual({ fixPayment: false, resume: false, managePayment: true, cancel: true });
    expect(Object.values(screen.offers).every((offer) => offer === null)).toBe(true);
    expect(screen.yearly).toEqual({ savingCents: 2980, offered: false });
  });

  it("gives an admin the plan and its state, and no command, offer or payment history", () => {
    const screen = planScreen(input({ ...base, status: "past_due", graceUntil: days(5) }, "pro", { isOwner: false }));
    expect(screen.commands).toBeNull();
    expect(Object.values(screen.offers).every((offer) => offer === null)).toBe(true);
    expect(screen.showHistory).toBe(false);
    expect(planScreen(input(base, "pro", { isOwner: false })).yearly).toEqual({ savingCents: 2980, offered: false });
  });
});

describe("plan screen: the catalogue", () => {
  it("lets the owner subscribe to each paid plan when there is no subscription", () => {
    for (const [record, planId] of [[null, "free"], [null, "agency"], [{ ...base, status: "ended" as const }, "free"]] as const) {
      expect(planScreen(input(record, planId)).offers).toEqual({ free: null, pro: "subscribe", agency: "subscribe" });
    }
  });

  it("offers a change to every paid plan but the one charged", () => {
    expect(planScreen(input(base, "pro")).offers).toEqual({ free: null, pro: null, agency: "change" });
    expect(planScreen(input({ ...base, planId: "agency" }, "agency")).offers).toEqual({ free: null, pro: "change", agency: null });
    // Pro is charged from the end of the period; going back to Agency undoes the scheduled change.
    expect(planScreen(input({ ...base, heldPlanId: "agency", heldUntil: days(10) }, "agency")).offers).toEqual({ free: null, pro: null, agency: "change" });
  });

  it("offers nothing to buy while a payment is failing, pending or cancelled", () => {
    for (const record of [{ ...base, status: "past_due" as const, graceUntil: days(5) }, { ...base, status: "incomplete" as const }, { ...base, cancelAtPeriodEnd: true }]) {
      expect(Object.values(planScreen(input(record, "pro")).offers).every((offer) => offer === null)).toBe(true);
    }
  });

  it("shows a running subscription's own interval, and a choice that starts monthly otherwise", () => {
    expect(planScreen(input(base, "pro")).prices).toEqual({ kind: "fixed", interval: "month", reason: "subscription" });
    expect(planScreen(input({ ...base, interval: "year" }, "pro")).prices).toEqual({ kind: "fixed", interval: "year", reason: "subscription" });
    expect(planScreen(input({ ...base, heldPlanId: "agency", heldUntil: days(10) }, "agency")).prices).toEqual({ kind: "fixed", interval: "month", reason: "subscription" });
    for (const record of [null, { ...base, status: "ended" as const }]) {
      expect(planScreen(input(record, "free")).prices).toEqual({ kind: "choice", initial: "month" });
    }
  });

  it("drops the interval choice when nothing can be bought: monthly prices stand as a reference", () => {
    for (const screen of [
      planScreen(input(null, "free", { isOwner: false })),
      planScreen(input({ ...base, cancelAtPeriodEnd: true }, "free")),
      planScreen(input({ ...base, status: "past_due" as const, graceUntil: days(5) }, "free")),
      planScreen(input(null, "free", { mode: "off" })),
    ]) {
      expect(screen.prices).toEqual({ kind: "fixed", interval: "month", reason: "reference" });
    }
  });

  it("says why no plan can be bought, the most basic reason first", () => {
    const blocked = (record: SubscriptionRecord | null, planId: PlanId, overrides: Parameters<typeof input>[2] = {}) => planScreen(input(record, planId, overrides)).blocked;
    expect(blocked(null, "free")).toBeNull();
    expect(blocked(base, "pro")).toBeNull();
    expect(blocked(base, "pro", { isOwner: false })).toBe("owner");
    expect(blocked({ ...base, status: "past_due", graceUntil: days(5) }, "pro", { isOwner: false })).toBe("owner");
    expect(blocked({ ...base, status: "past_due", graceUntil: days(5) }, "pro")).toBe("payment");
    expect(blocked({ ...base, status: "past_due", graceUntil: days(-1) }, "free")).toBe("payment");
    expect(blocked({ ...base, status: "incomplete" }, "free")).toBe("payment");
    expect(blocked({ ...base, cancelAtPeriodEnd: true }, "pro")).toBe("canceling");
    expect(blocked(base, "pro", { suspended: true })).toBe("suspended");
    expect(blocked(base, "pro", { mode: "off", isOwner: false })).toBe("off");
    expect(blocked(null, "free", { deployed: false, mode: "off" })).toBe("notDeployed");
  });

  it("offers yearly billing only to a monthly subscription in good standing", () => {
    expect(planScreen(input(base, "pro")).yearly).toEqual({ savingCents: 2980, offered: true });
    expect(planScreen(input({ ...base, planId: "agency" }, "agency")).yearly).toEqual({ savingCents: 11580, offered: true });
    expect(planScreen(input(base, "pro", { mode: "off" })).yearly).toEqual({ savingCents: 2980, offered: false });
    const yearly = planScreen(input({ ...base, interval: "year" }, "pro"));
    expect(yearly.yearly).toBeNull();
    expect(yearly.yearlyOnly).toBe(true);
    expect(planScreen(input({ ...base, cancelAtPeriodEnd: true }, "pro")).yearly).toBeNull();
    expect(planScreen(input({ ...base, heldPlanId: "agency", heldUntil: days(10) }, "agency")).yearly).toBeNull();
  });

  it("shows the payment history to the owner once billing exists, whether or not plans are for sale", () => {
    expect(planScreen(input(base, "pro", { mode: "off" })).showHistory).toBe(true);
    expect(planScreen(input(null, "free", { deployed: false })).showHistory).toBe(false);
  });
});

describe("plan screen: usage against the plan in force", () => {
  const usage = (overrides: Partial<WorkspaceUsage> = {}): WorkspaceUsage => ({ pages: 1, members: 1, pendingInvitations: 0, activeReportLinks: 0, storageBytes: 0, activeDomains: 0, pagesWithPixels: 0, ...overrides });

  it("is left out when it could not be read", () => {
    expect(planScreen(input(null, "free")).usage).toBeNull();
  });

  it("compares pages, seats and image space with the plan's limits", () => {
    expect(planScreen(input(null, "free", { usage: usage({ storageBytes: 5 * 1048576 }) })).usage).toEqual([
      { key: "pages", used: 1, limit: 1, level: "full", pending: 0 },
      { key: "seats", used: 1, limit: 1, level: "full", pending: 0 },
      { key: "storage", used: 5, limit: 20, level: "ok", pending: 0 },
    ]);
  });

  it("counts open invitations as seats", () => {
    const [, seats] = planScreen(input(null, "agency", { usage: usage({ members: 2, pendingInvitations: 2 }) })).usage ?? [];
    expect(seats).toEqual({ key: "seats", used: 4, limit: 5, level: "ok", pending: 2 });
  });

  it("marks what is above the limit, as after a cheaper plan", () => {
    const [pages] = planScreen(input(null, "free", { usage: usage({ pages: 4 }) })).usage ?? [];
    expect(pages).toMatchObject({ used: 4, limit: 1, level: "over" });
  });

  it("uses the limits of the plan the workspace has today, not of a plan only scheduled", () => {
    // Agency paid until the change: the workspace still has Agency's limits.
    const screen = planScreen(input({ ...base, planId: "pro", heldPlanId: "agency", heldUntil: days(10) }, "agency", { usage: usage({ pages: 6 }) }));
    expect(screen.usage?.[0]).toMatchObject({ used: 6, limit: 10, level: "ok" });
  });
});
