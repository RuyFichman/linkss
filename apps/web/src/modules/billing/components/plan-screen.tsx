import Link from "next/link";
import type { Copy } from "@/content/copy";
import type { PlanId } from "@/lib/product";
import { Badge, Notice } from "@/ui";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { openSelfServiceAction, resumeSubscriptionAction, startCheckoutAction } from "../actions";
import { BILLING_INTERVALS, PLAN_IDS, formatMoney, isPaidPlan, planPrice, yearlySavingCents, type BillingInterval } from "../catalog";
import { planHighlights } from "../comparison";
import { yearlyFreeMonths } from "../marketing";
import type { BillingMode } from "../mode";
import { INVOICE_TONE, STATE_TONE, type CatalogueBlock, type PlanScreen, type PlanSummary, type PlanUsageRow, type UsageLevel } from "../plan-screen";
import { formatBillingDate, planHighlightText, priceLabel } from "../presentation";
import type { InvoiceView } from "../read";
import { BillingActionForm } from "./billing-action-form";
import { PlanComparisonTable } from "./plan-comparison";

type BillingWords = Copy["BILLING_COPY"];

const SUMMARY_BOX = {
  warning: "rounded-xl border border-app-warning/30 bg-app-warning/10 px-4 py-3",
  danger: "rounded-xl border border-app-danger/30 bg-app-danger/10 px-4 py-3",
} as const;

/** The title of every state of the screen, including the ones that show nothing else. */
export function PlanHeading({ copy }: { copy: BillingWords }) {
  return (
    <header className="grid gap-2">
      <h1 className="text-3xl font-bold">{copy.title}</h1>
    </header>
  );
}

function Summary({ summary }: { summary: PlanSummary }) {
  if (summary.kind === "facts") {
    return (
      <dl className="m-0 grid gap-x-10 gap-y-3 sm:grid-flow-col sm:justify-start">
        {summary.facts.map((fact) => (
          <div key={fact.key} className="grid gap-0.5">
            <dt className="text-sm text-app-muted">{fact.label}</dt>
            {/* Tabular figures for dates only: in the product typeface they also widen the decimal comma of an amount. */}
            <dd className="m-0 text-lg font-semibold">{fact.dateTime ? <time className="tabular-nums" dateTime={fact.dateTime}>{fact.value}</time> : fact.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <p className={summary.tone === "neutral" ? "m-0" : `m-0 ${SUMMARY_BOX[summary.tone]}`}>{summary.text}</p>;
}

const MEGABYTES = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
/** "3,2"; anything stored shows as at least 0,1. */
function formatMegabytes(megabytes: number): string {
  return MEGABYTES.format(megabytes > 0 && megabytes < 0.1 ? 0.1 : megabytes);
}

// Above a limit is a warning, never danger: nothing is deleted, only new creations wait.
const USAGE_BAR: Record<UsageLevel, string> = { ok: "bg-app-ink", full: "bg-app-warning", over: "bg-app-warning" };

function UsageRow({ row, copy }: { copy: BillingWords; row: PlanUsageRow }) {
  const value = row.key === "storage" ? copy.usage.megabytes(formatMegabytes(row.used), row.limit) : copy.usage.count(row.used, row.limit);
  const filled = row.limit > 0 ? Math.min(1, row.used / row.limit) : 1;
  const notes = [
    row.level === "over" ? copy.usage.overNote[row.key] : null,
    row.key === "seats" && row.pending > 0 ? copy.usage.pending(row.pending) : null,
    row.key === "pages" && row.level !== "ok" ? copy.usage.archived : null,
  ].filter((note) => note !== null);
  return (
    <li className="grid gap-1.5">
      <p className="m-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span>{copy.usage[row.key]}</span>
        <span className="flex items-center gap-2 font-semibold">
          {value}
          {row.level === "ok" ? null : <Badge tone="warning">{row.level === "over" ? copy.usage.over : copy.usage.full}</Badge>}
        </span>
      </p>
      {/* The words above carry the state; the bar only shows it at a glance, so an empty one is left out. */}
      {row.used > 0 ? (
        <span className="block h-1.5 overflow-hidden rounded-full bg-app-surface-soft" aria-hidden="true">
          <span className={`block h-full rounded-full ${USAGE_BAR[row.level]}`} style={{ width: `${Math.max(2, Math.round(filled * 100))}%` }} />
        </span>
      ) : null}
      {notes.map((note) => <p key={note} className="m-0 text-sm text-app-muted">{note}</p>)}
    </li>
  );
}

/**
 * What the workspace uses against the plan in force: what decides whether a bigger plan is needed.
 * A card of its own, after the plan on phones, so it never pushes the plan's actions down.
 */
function Usage({ rows, copy }: { copy: BillingWords; rows: PlanUsageRow[] }) {
  return (
    <section className="surface-card grid content-start gap-4 p-5 sm:p-6" aria-labelledby="usage-title">
      <h2 id="usage-title" className="text-sm font-semibold text-app-muted">{copy.usage.title}</h2>
      <ul className="m-0 grid list-none gap-4 p-0">
        {rows.map((row) => <UsageRow copy={copy} key={row.key} row={row} />)}
      </ul>
    </section>
  );
}

/**
 * The plan of the workspace first: what it is, what it costs or what is wrong, and the one thing to
 * do about it. The catalogue and the payment history follow.
 */
function CurrentPlan({ workspaceId, screen, copy }: { copy: BillingWords; workspaceId: string; screen: PlanScreen }) {
  const { state, commands, yearly } = screen;
  const hasCommands = commands !== null && (commands.fixPayment || commands.resume || commands.managePayment || commands.cancel);
  return (
    <section className="surface-card overflow-hidden" aria-labelledby="current-plan-title">
      <div className="grid gap-5 p-5 sm:p-6">
        <div className="grid content-start gap-4">
          <div className="grid gap-1">
            <h2 id="current-plan-title" className="text-sm font-semibold text-app-muted">{copy.current.title}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="brand-display m-0 text-3xl font-extrabold">{copy.planNames[screen.currentPlan]}</p>
              {state.kind === "free" ? null : <Badge tone={STATE_TONE[state.kind]}>{copy.statusLabel[state.kind]}</Badge>}
            </div>
          </div>
          <Summary summary={screen.summary} />
          {yearly ? (
            <div className="flex flex-wrap items-center gap-x-4 text-sm">
              <p className="m-0 text-app-muted">{copy.plans.toYearlyHint(formatMoney(yearly.savingCents))}</p>
              {yearly.offered ? <Link className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" href={`/app/w/${workspaceId}/plano/confirmar?acao=anual`}>{copy.plans.toYearly}</Link> : null}
            </div>
          ) : null}
          {screen.yearlyOnly ? <p className="m-0 text-sm text-app-muted">{copy.plans.yearlyOnly}</p> : null}
        </div>
      </div>
      {/* Who may act is said next to the plans (CatalogueNote), where the missing buttons are. */}
      {hasCommands ? (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-app-border bg-app-surface-soft/50 px-5 py-4 sm:px-6">
          <div className="flex w-full flex-wrap items-start gap-3 sm:w-auto">
            {commands.fixPayment ? <BillingActionForm action={openSelfServiceAction.bind(null, workspaceId)} label={copy.actions.fixPayment} /> : null}
            {commands.resume && screen.resumePlanId ? (
              <ConfirmDialog action={resumeSubscriptionAction.bind(null, workspaceId)} openLabel={copy.actions.resume} openVariant="secondary" title={copy.actions.resumeTitle} confirmLabel={copy.actions.resumeConfirm} cancelLabel={copy.actions.resumeCancel}>
                <p className="m-0 text-app-muted">{copy.actions.resumeBody(copy.planNames[screen.resumePlanId])}</p>
              </ConfirmDialog>
            ) : null}
            {commands.managePayment ? <BillingActionForm action={openSelfServiceAction.bind(null, workspaceId)} label={copy.actions.managePayment} variant="secondary" /> : null}
          </div>
          {/* Findable, never next to the main action with the same weight. */}
          {commands.cancel ? <p className="m-0 text-sm text-app-muted"><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={`/app/w/${workspaceId}/plano/confirmar?acao=cancelar`}>{copy.actions.cancel}</Link></p> : null}
        </div>
      ) : null}
    </section>
  );
}

function PlanCard({ workspaceId, planId, screen, intervals, choice, customDomains, copy }: {
  copy: BillingWords;
  workspaceId: string;
  planId: PlanId;
  screen: PlanScreen;
  intervals: readonly BillingInterval[];
  choice: boolean;
  customDomains: boolean;
}) {
  const name = copy.planNames[planId];
  const paid = isPaidPlan(planId);
  const isCurrent = planId === screen.currentPlan;
  const offer = screen.offers[planId];
  const saving = yearlySavingCents(planId);
  // Under a choice of interval each price and its button belong to one interval; CSS shows the chosen one.
  const intervalOf = (interval: BillingInterval) => (choice ? interval : undefined);
  return (
    <li className="plan-offer" data-featured={isCurrent ? "" : undefined} aria-current={isCurrent ? "true" : undefined}>
      {/* A plain badge next to the name: inside the account the cards are managed, not sold (UX-113). */}
      <div className="plan-offer-name">
        <h3 className="brand-display font-extrabold">{name}</h3>
        {isCurrent ? <Badge>{copy.current.badge}</Badge> : null}
      </div>
      {intervals.map((interval) => {
        const price = paid ? planPrice(planId, interval) : null;
        if (paid && !price) return null;
        return (
          <p key={interval} className="plan-offer-price" data-interval={intervalOf(interval)}>
            {/* The spaces keep the words apart for screen readers; the flex layout does not render them. */}
            <b className="brand-display">{price ? formatMoney(price.amountCents) : copy.freePrice}</b>{" "}
            <span aria-hidden="true">{copy.perShort[interval]}</span>
            <span className="sr-only">{copy.perInterval[interval]}</span>
          </p>
        );
      })}
      {/* Always present, empty when there is nothing to say: the cards share their rows (globals.css). */}
      <p className="plan-offer-saving">{paid && choice && saving > 0 ? copy.yearlySaving(formatMoney(saving)) : null}</p>
      <p className="plan-offer-description">{copy.planDescriptions[planId]}</p>
      <ul className="plan-offer-items">
        {planHighlights(planId, { customDomains }).map((item) => <li key={item.kind === "everythingIn" ? item.kind : item.key}>{planHighlightText(item, copy)}</li>)}
      </ul>
      <div className="plan-offer-action">
        {offer === "subscribe" ? intervals.map((interval) => {
          const price = planPrice(planId, interval);
          const label = copy.plans.subscribe(name, copy.intervalAdjective[interval]);
          return price ? (
            <div key={interval} data-interval={intervalOf(interval)}>
              <BillingActionForm action={startCheckoutAction.bind(null, workspaceId, planId, interval)} label={label} ariaLabel={`${label}: ${priceLabel(price.amountCents, interval, copy)}`} fullWidth />
            </div>
          ) : null;
        }) : null}
        {offer === "change" ? <Link className="ui-button ui-button-secondary w-full" href={`/app/w/${workspaceId}/plano/confirmar?acao=mudar&plano=${planId}`}>{copy.plans.changeTo(name)}</Link> : null}
      </div>
    </li>
  );
}

function blockText(copy: Copy["BILLING_COPY"], blocked: Exclude<CatalogueBlock, "other">): string {
  const text: Record<Exclude<CatalogueBlock, "other">, string> = {
    notDeployed: copy.notDeployed,
    off: copy.off,
    owner: copy.ownerOnly,
    suspended: copy.plans.blocked.suspended,
    payment: copy.plans.blocked.payment,
    canceling: copy.plans.blocked.canceling,
  };
  return text[blocked];
}

/** Why nothing below can be bought, right above the plans, with the way out when there is one. */
function CatalogueNote({ workspaceId, screen, copy }: { copy: BillingWords; workspaceId: string; screen: PlanScreen }) {
  const { blocked, commands } = screen;
  if (!blocked || blocked === "other") return null;
  const fix = blocked === "payment" && commands?.fixPayment;
  return (
    <div className={`grid gap-3 sm:flex sm:items-center sm:justify-between ${blocked === "payment" ? SUMMARY_BOX.warning : "rounded-xl border border-app-border bg-app-surface-soft/60 px-4 py-3"}`}>
      <p className="m-0">{blockText(copy, blocked)}</p>
      {/* The same command as the plan card's: the second place a person looks for it. */}
      {fix ? <BillingActionForm action={openSelfServiceAction.bind(null, workspaceId)} label={copy.actions.fixPayment} variant="secondary" /> : null}
    </div>
  );
}

function Catalogue({ workspaceId, screen, mode, customDomains, copy }: { copy: BillingWords; workspaceId: string; screen: PlanScreen; mode: BillingMode; customDomains: boolean }) {
  const { prices } = screen;
  const choice = prices.kind === "choice";
  const intervals = prices.kind === "fixed" ? [prices.interval] : BILLING_INTERVALS;
  const freeMonths = yearlyFreeMonths();
  const offers = (
    <ul className="plan-offers">
      {PLAN_IDS.map((planId) => <PlanCard copy={copy} key={planId} workspaceId={workspaceId} planId={planId} screen={screen} intervals={intervals} choice={choice} customDomains={customDomains} />)}
    </ul>
  );
  return (
    <section className="plan-catalogue grid gap-6" aria-labelledby="plans-title" data-interval-scope="">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid gap-1">
          <h2 id="plans-title" className="text-xl font-bold">{copy.plans.title}</h2>
          <p className="m-0 text-app-muted">{copy.plans.lead}</p>
          {/* About selling, next to the prices it qualifies: a label and a line, not a box that reads as a field. */}
          {mode === "sandbox" ? (
            <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-app-muted">
              <Badge tone="warning">{copy.sandboxLabel}</Badge>
              <span>{copy.sandboxDetail}</span>
            </p>
          ) : null}
          {prices.kind === "fixed" ? <p className="m-0 text-sm text-app-muted">{prices.reason === "subscription" ? copy.plans.pricesFor(copy.intervalAdjective[prices.interval]) : copy.plans.referencePrices}</p> : null}
        </div>
        {/* Two native radios: the chosen interval's prices stay visible through CSS alone (globals.css). */}
        {prices.kind === "choice" ? (
          <fieldset className="plan-interval">
            <legend className="sr-only">{copy.plans.intervalLegend}</legend>
            {BILLING_INTERVALS.map((interval) => (
              <label key={interval}>
                <input type="radio" name="plan-interval" value={interval} defaultChecked={interval === prices.initial} />
                <span>{copy.intervals[interval]}{interval === "year" && freeMonths ? <>{" "}<b className="plan-interval-badge">{copy.freeMonths(freeMonths)}</b></> : null}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>
      <CatalogueNote copy={copy} workspaceId={workspaceId} screen={screen} />
      {screen.blocked ? (
        // Nothing to buy: the plans stay one tap away instead of a long showcase without a button.
        <details className="plan-compare-details">
          <summary id="compare-title">{copy.plans.show}</summary>
          <div className="mt-8 grid gap-8">
            {offers}
            <PlanComparisonTable words={copy} customDomains={customDomains} labelledBy="compare-title" rows="differences" />
          </div>
        </details>
      ) : (
        <>
          {offers}
          {screen.selling ? <p className="m-0 text-sm text-app-muted">{copy.provider}</p> : null}
          <details className="plan-compare-details">
            <summary id="compare-title">{copy.plans.differences}</summary>
            <PlanComparisonTable words={copy} customDomains={customDomains} labelledBy="compare-title" rows="differences" />
          </details>
        </>
      )}
    </section>
  );
}

// Date and amount side by side, the amount right-aligned so values compare down the column (no tabular
// figures: in the product typeface they widen the decimal comma); status takes the rest.
const HISTORY_COLUMNS = "sm:grid-cols-[7rem_7rem_minmax(0,1fr)_auto] sm:gap-x-8";

/** One row per payment that reads on a phone without sideways scrolling: date and amount, then status and receipt. */
function PaymentHistory({ invoices, copy }: { copy: BillingWords; invoices: InvoiceView[] }) {
  const columns = copy.history.columns;
  return (
    <section className="surface-card grid gap-4 p-5 sm:p-6" aria-labelledby="payments-title">
      <div className="grid gap-1">
        <h2 id="payments-title" className="text-xl font-bold">{copy.history.title}</h2>
        <p className="m-0 text-sm text-app-muted">{copy.history.lead}</p>
      </div>
      {invoices.length === 0 ? <p className="m-0 text-app-muted">{copy.history.empty}</p> : (
        <div>
          {/* Visual column names; each value also carries its own name for assistive technology. */}
          <div aria-hidden="true" className={`hidden gap-4 border-b border-app-border pb-2 text-sm font-semibold text-app-muted sm:grid ${HISTORY_COLUMNS}`}>
            <span>{columns.date}</span><span className="text-right">{columns.amount}</span><span>{columns.status}</span><span className="text-right">{columns.receipt}</span>
          </div>
          <ul className="m-0 list-none p-0">
            {invoices.map((invoice) => {
              const when = formatBillingDate(invoice.paidAt ?? invoice.issuedAt);
              return (
                <li key={invoice.id} className="border-b border-app-border py-2 last:border-0">
                  <dl className={`m-0 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 ${HISTORY_COLUMNS}`}>
                    <div><dt className="sr-only">{columns.date}</dt><dd className="m-0 tabular-nums"><time dateTime={invoice.paidAt ?? invoice.issuedAt}>{when}</time></dd></div>
                    <div className="text-right"><dt className="sr-only">{columns.amount}</dt><dd className="m-0 font-semibold">{formatMoney(invoice.amountCents)}</dd></div>
                    <div><dt className="sr-only">{columns.status}</dt><dd className="m-0"><Badge tone={INVOICE_TONE[invoice.status]}>{copy.history.status[invoice.status]}</Badge></dd></div>
                    <div className="text-right">
                      <dt className="sr-only">{columns.receipt}</dt>
                      <dd className="m-0">
                        {invoice.receiptUrl
                          ? <a className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" href={invoice.receiptUrl} target="_blank" rel="noopener noreferrer" aria-label={copy.history.receiptFor(when)}>{copy.history.receipt}</a>
                          : <span className="inline-flex min-h-11 items-center text-sm text-app-muted">{copy.history.noReceipt}</span>}
                      </dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Plan and billing of one workspace (ADR 0014, UX-106, UX-108). Server-rendered presentation of planScreen:
 * the route loads and authorizes, the actions re-authorize, and nothing here decides who may do what.
 * `data-plan-screen` hides the workspace's failing-payment banner here, where the card says the same
 * thing next to the way to fix it (globals.css).
 */
export function PlanScreenView({ workspaceId, screen, invoices, mode, suspended, customDomains, notice, copy }: {
  copy: BillingWords;
  workspaceId: string;
  screen: PlanScreen;
  invoices: InvoiceView[];
  mode: BillingMode;
  suspended: boolean;
  customDomains: boolean;
  notice: string | null;
}) {
  return (
    <div className="grid gap-6" data-plan-screen="">
      <PlanHeading copy={copy} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {suspended ? <Notice tone="warning">{copy.suspended}</Notice> : null}
      {screen.usage ? (
        // Each card keeps its own height: stretched to the taller one, either would end in empty space.
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
          <CurrentPlan copy={copy} workspaceId={workspaceId} screen={screen} />
          <Usage copy={copy} rows={screen.usage} />
        </div>
      ) : <CurrentPlan copy={copy} workspaceId={workspaceId} screen={screen} />}
      <Catalogue copy={copy} workspaceId={workspaceId} screen={screen} mode={mode} customDomains={customDomains} />
      {screen.showHistory ? <PaymentHistory copy={copy} invoices={invoices} /> : null}
    </div>
  );
}
