import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PlanId } from "@/lib/product";
import type { BillingMode } from "../mode";
import { planScreen } from "../plan-screen";
import type { InvoiceView, WorkspaceBilling } from "../read";
import type { SubscriptionRecord } from "../subscription";

vi.mock("next/link", () => ({ default: "a" }));
// The Server Actions talk to the provider and the database; the screen only binds them.
vi.mock("../actions", () => ({ openSelfServiceAction: vi.fn(), resumeSubscriptionAction: vi.fn(), startCheckoutAction: vi.fn() }));

const { PlanHeading, PlanScreenView } = await import("./plan-screen");

const WORKSPACE = "11111111-2222-3333-4444-555555555555";
const T0 = new Date("2026-10-09T15:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const days = (count: number) => new Date(T0.getTime() + count * DAY_MS);
const base: SubscriptionRecord = { status: "active", planId: "pro", interval: "month", currentPeriodEnd: days(30), cancelAtPeriodEnd: false, graceUntil: null, heldPlanId: null, heldUntil: null };
const INVOICES: InvoiceView[] = [
  { id: "a", amountCents: 1490, status: "paid", issuedAt: "2026-09-08T15:00:00Z", paidAt: "2026-09-08T15:01:00Z", receiptUrl: "https://invoice.stripe.example.test/a" },
  { id: "b", amountCents: 1490, status: "open", issuedAt: "2026-10-08T15:00:00Z", paidAt: null, receiptUrl: null },
];

function render(record: SubscriptionRecord | null, planId: PlanId, options: { mode?: BillingMode; isOwner?: boolean; suspended?: boolean; deployed?: boolean; invoices?: InvoiceView[]; notice?: string | null } = {}) {
  const { mode = "sandbox", isOwner = true, suspended = false, deployed = true, invoices = [], notice = null } = options;
  const billing: WorkspaceBilling = { deployed, planId, record, amountCents: record ? (record.planId === "agency" ? 5790 : 1490) : null, invoices };
  const screen = planScreen({ billing, mode, isOwner, suspended, now: T0 });
  const html = renderToStaticMarkup(createElement(PlanScreenView, { workspaceId: WORKSPACE, screen, invoices: isOwner ? invoices : [], mode, deployed, suspended, customDomains: true, notice }));
  return { html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") };
}

const between = (html: string, start: string, end: string) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const currentCard = (html: string) => between(html, 'aria-labelledby="current-plan-title"', "</section>");
const primaryButtons = (html: string) => [...html.matchAll(/<button[^>]*class="ui-button ui-button-primary[^"]*"[^>]*>([^<]*)</g)].map((match) => match[1]);
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("plan screen: one state at a time", () => {
  it("past due, owner: the problem and its deadline first, one way to fix it, cancel apart", () => {
    const { html } = render({ ...base, status: "past_due", graceUntil: days(5) }, "pro", { invoices: INVOICES });
    const card = currentCard(html);
    expect(card).toContain("Pagamento pendente");
    expect(card).toContain("Não conseguimos cobrar o último pagamento. O plano Pro continua valendo até 14/10/2026.");
    expect(card).toContain("border-app-danger/30");
    expect(primaryButtons(card)).toEqual(["Atualizar forma de pagamento"]);
    expect(card).not.toContain("Forma de pagamento e recibos");
    expect(card).toContain(`href="/app/w/${WORKSPACE}/plano/confirmar?acao=cancelar"`);
    expect(card).not.toMatch(/class="ui-button[^"]*"[^>]*>Cancelar assinatura/);
    // The plan comes before the test-environment notice and the catalogue.
    expect(html.indexOf("current-plan-title")).toBeLessThan(html.indexOf("Ambiente de teste"));
    expect(html.indexOf("Ambiente de teste")).toBeLessThan(html.indexOf('id="plans-title"'));
    expect(html).toContain("data-plan-screen");
  });

  it("past due, admin: the same problem, told who can fix it, no button", () => {
    const { html } = render({ ...base, status: "past_due", graceUntil: days(5) }, "pro", { isOwner: false });
    const card = currentCard(html);
    expect(card).toContain("Não conseguimos cobrar o último pagamento");
    expect(card).not.toContain("<button");
    expect(count(html, "Só o proprietário desta conta pode contratar, alterar ou cancelar o plano.")).toBe(1);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("payments-title");
  });

  it("grace over: says the plan is suspended and the data is kept, with the fix", () => {
    const { html } = render({ ...base, status: "past_due", graceUntil: days(-1) }, "free");
    const card = currentCard(html);
    expect(card).toContain("Plano suspenso por falta de pagamento");
    expect(card).toContain("continuam guardados");
    expect(primaryButtons(card)).toEqual(["Atualizar forma de pagamento"]);
  });

  it("first payment pending: a warning and the fix, nothing to cancel", () => {
    const { html } = render({ ...base, status: "incomplete" }, "free");
    const card = currentCard(html);
    expect(card).toContain("border-app-warning/30");
    expect(primaryButtons(card)).toEqual(["Atualizar forma de pagamento"]);
    expect(card).not.toContain("acao=cancelar");
  });

  it("active monthly, owner: the amount and the next charge as facts, the yearly offer, a quiet cancel", () => {
    const { html, text } = render(base, "pro");
    const card = currentCard(html);
    expect(card).toMatch(/<dt[^>]*>Valor<\/dt><dd[^>]*>R\$ 14,90 por mês<\/dd>/);
    expect(card).toMatch(/<dt[^>]*>Próxima cobrança<\/dt><dd[^>]*><time[^>]*dateTime="2026-11-08T15:00:00.000Z"[^>]*>08\/11\/2026<\/time>/);
    expect(card).not.toContain("Plano Pro, cobrança mensal.");
    expect(text).toContain("Sua assinatura é mensal. No anual você paga R$ 29,80 a menos por ano.");
    expect(card).toContain(`href="/app/w/${WORKSPACE}/plano/confirmar?acao=anual"`);
    expect(primaryButtons(card)).toEqual([]);
    expect(card).toContain("Forma de pagamento e recibos");
    expect(card).toContain("acao=cancelar");
  });

  it("active monthly: the catalogue shows monthly prices, says why, and offers the change, not a new subscription", () => {
    const { html, text } = render(base, "pro");
    expect(html).not.toContain('type="radio"');
    expect(text).toContain("Valores com cobrança mensal, como a sua assinatura.");
    expect(text).toContain("R$ 57,90");
    expect(text).not.toContain("R$ 579,00");
    expect(html).toContain(`href="/app/w/${WORKSPACE}/plano/confirmar?acao=mudar&amp;plano=agency"`);
    expect(html).not.toContain("plano=pro");
    expect(html).not.toContain("Assinar");
    expect(html).toMatch(/<li class="plan-card[^"]*" aria-current="true"><div[^>]*><div[^>]*><h3[^>]*>Pro<\/h3>/);
  });

  it("active yearly: yearly prices, how to go back to monthly, no yearly offer", () => {
    const { html, text } = render({ ...base, interval: "year" }, "pro");
    expect(text).toContain("Sua assinatura é anual. Para voltar ao mensal");
    expect(text).not.toContain("Passar para o anual");
    expect(text).toContain("Valores com cobrança anual, como a sua assinatura.");
    expect(text).toContain("R$ 579,00");
    expect(text).not.toContain("R$ 57,90");
    expect(currentCard(html)).toContain("R$ 14,90 por ano");
  });

  it("active, admin: the facts, the yearly saving without the link, no command", () => {
    const { html, text } = render(base, "pro", { isOwner: false });
    expect(currentCard(html)).toContain("R$ 14,90 por mês");
    expect(text).toContain("No anual você paga R$ 29,80 a menos por ano.");
    expect(html).not.toContain("acao=anual");
    expect(html).not.toContain("acao=cancelar");
    expect(html).not.toContain("<button");
    expect(count(html, "Só o proprietário")).toBe(1);
    // No card offers anything: no empty row is kept for it.
    expect(count(html, "lg:row-span-3")).toBe(3);
    expect(html).not.toContain("lg:row-span-4");
    expect(html).not.toContain("max-lg:empty:hidden");
  });

  it("cancelled: when the plan ends and the one way back", () => {
    const { html } = render({ ...base, cancelAtPeriodEnd: true }, "pro");
    const card = currentCard(html);
    expect(card).toContain("Assinatura cancelada. O plano Pro continua valendo até 08/11/2026.");
    expect(card).toContain("Manter a assinatura");
    expect(card).not.toContain("acao=cancelar");
    expect(card).not.toContain("Forma de pagamento e recibos");
  });

  it("downgrade scheduled: the plan in force, when it changes, and the way back", () => {
    const { html } = render({ ...base, heldPlanId: "agency", heldUntil: days(10) }, "agency");
    const card = currentCard(html);
    expect(card).toMatch(/<p class="brand-display[^"]*">Agência<\/p>/);
    expect(card).toContain("A partir dessa data a conta passa para o plano Pro.");
    expect(html).toContain("plano=agency");
  });

  it("free, owner: no command on the plan, a monthly or yearly choice and a subscription per paid plan", () => {
    const { html, text } = render(null, "free");
    const card = currentCard(html);
    expect(card).toContain("Esta conta está no plano Gratuito. Não há cobrança.");
    expect(card).not.toContain("<button");
    expect(html).toMatch(/<input type="radio" name="plan-interval" checked="" value="month"\/>/);
    expect(html).toMatch(/<input type="radio" name="plan-interval" value="year"\/>/);
    for (const label of ["Assinar Pro mensal", "Assinar Pro anual", "Assinar Agência mensal", "Assinar Agência anual"]) expect(text).toContain(label);
    expect(html).toContain('aria-label="Assinar Pro mensal: R$ 14,90 por mês"');
    expect(count(html, 'data-interval="month"')).toBe(4);
    expect(count(html, 'data-interval="year"')).toBe(4);
    // The free card keeps an empty offer row so the three feature lists line up.
    expect(count(html, "lg:row-span-4")).toBe(3);
    expect(text).toContain("R$ 29,80 a menos");
    expect(text).toContain("R$ 115,80 a menos");
    expect(text).toContain("Nenhum pagamento até agora.");
  });

  it("a plan set by hand: says so once, and subscribing is offered", () => {
    const { text } = render(null, "agency");
    expect(count(text, "definido manualmente")).toBe(1);
    expect(text).toContain("Assinar Pro mensal");
  });

  it("billing off: says paid plans are not for sale, offers nothing, keeps the history", () => {
    const { html, text } = render(base, "pro", { mode: "off", invoices: INVOICES });
    expect(text).toContain("Os planos pagos ainda não estão à venda.");
    expect(text).not.toContain("Ambiente de teste");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("acao=");
    expect(text).not.toContain("Só o proprietário");
    expect(html).toContain("payments-title");
    expect(text).not.toContain("O pagamento é feito na página do provedor");
  });

  it("before the migration: says the area is not available yet", () => {
    const { text } = render(null, "free", { deployed: false });
    expect(text).toContain("ainda não está disponível neste ambiente");
    expect(text).not.toContain("Pagamentos");
  });

  it("suspended workspace: says so before the plan, keeps fixing and cancelling, offers nothing to buy", () => {
    const { html } = render(base, "pro", { suspended: true });
    expect(html.indexOf("Esta conta está suspensa")).toBeLessThan(html.indexOf("current-plan-title"));
    expect(html).not.toContain("acao=anual");
    expect(html).not.toContain("acao=mudar");
    expect(html).toContain("acao=cancelar");
  });

  it("puts the notice of what just happened under the title", () => {
    const { html } = render(base, "pro", { notice: "Plano alterado. A mudança já está valendo." });
    expect(html.indexOf("Plano alterado.")).toBeLessThan(html.indexOf("current-plan-title"));
  });
});

describe("plan screen: payment history", () => {
  it("is a list that needs no sideways scrolling, each value named, status in words", () => {
    const { html } = render(base, "pro", { invoices: INVOICES });
    const history = between(html, 'aria-labelledby="payments-title"', "</section>");
    expect(history).not.toContain("<table");
    expect(history).not.toContain("min-w-");
    expect(count(history, "<li ")).toBe(2);
    expect(history).toMatch(/<dt class="sr-only">Data<\/dt><dd[^>]*><time[^>]*dateTime="2026-09-08T15:01:00Z"[^>]*>08\/09\/2026<\/time>/);
    expect(history).toContain('<span class="ui-badge ui-badge-success">Pago</span>');
    expect(history).toContain('<span class="ui-badge ui-badge-warning">Em aberto</span>');
    expect(history).toContain('aria-label="Ver recibo do pagamento de 08/09/2026"');
    expect(history).toContain('href="https://invoice.stripe.example.test/a"');
    // A row without a receipt is as tall as one with the link.
    expect(history).toContain('<span class="inline-flex min-h-11 items-center text-sm text-app-muted">Sem recibo</span>');
    // Column names for sight only; the values carry their own.
    expect(history).toMatch(/<div aria-hidden="true"[^>]*><span>Data<\/span>/);
  });
});

describe("plan screen: heading", () => {
  it("is the same title in every state, with the lead only on the full screen", () => {
    expect(renderToStaticMarkup(createElement(PlanHeading))).toBe('<header class="grid gap-2"><h1 class="text-3xl font-bold">Plano e cobrança</h1></header>');
    expect(renderToStaticMarkup(createElement(PlanHeading, { lead: true }))).toContain("O plano define quantas páginas");
  });
});
