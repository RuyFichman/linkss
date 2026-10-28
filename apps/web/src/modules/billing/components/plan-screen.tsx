import Link from "next/link";
import { BILLING_COPY } from "@/content/pt-BR";
import type { PlanId } from "@/lib/product";
import { Badge, Notice } from "@/ui";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { openSelfServiceAction, resumeSubscriptionAction, startCheckoutAction } from "../actions";
import { BILLING_INTERVALS, PLAN_IDS, formatMoney, isPaidPlan, planPrice, yearlySavingCents, type BillingInterval } from "../catalog";
import type { BillingMode } from "../mode";
import { INVOICE_TONE, STATE_TONE, type PlanScreen, type PlanSummary } from "../plan-screen";
import { formatBillingDate, planFeatureLines, priceLabel } from "../presentation";
import type { InvoiceView } from "../read";
import { BillingActionForm } from "./billing-action-form";

const copy = BILLING_COPY;

const SUMMARY_BOX = {
  warning: "rounded-xl border border-app-warning/30 bg-app-warning/10 px-4 py-3",
  danger: "rounded-xl border border-app-danger/30 bg-app-danger/10 px-4 py-3",
} as const;

/** The title of every state of the screen, including the ones that show nothing else. */
export function PlanHeading({ lead = false }: { lead?: boolean }) {
  return (
    <header className="grid gap-2">
      <h1 className="text-3xl font-bold">{copy.title}</h1>
      {lead ? <p className="m-0 text-app-muted">{copy.lead}</p> : null}
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

/**
 * The plan of the workspace first: what it is, what it costs or what is wrong, and the one thing to
 * do about it. The catalogue and the payment history follow.
 */
function CurrentPlan({ workspaceId, screen }: { workspaceId: string; screen: PlanScreen }) {
  const { state, commands, yearly } = screen;
  const hasCommands = commands !== null && (commands.fixPayment || commands.resume || commands.managePayment || commands.cancel);
  return (
    <section className="surface-card overflow-hidden" aria-labelledby="current-plan-title">
      <div className="grid gap-4 p-5 sm:p-6">
        <div className="grid gap-1">
          <h2 id="current-plan-title" className="text-sm font-semibold text-app-muted">{copy.current.title}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="brand-display m-0 text-2xl font-bold">{copy.planNames[screen.currentPlan]}</p>
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
      {commands === null ? (
        <p className="m-0 border-t border-app-border bg-app-surface-soft/50 px-5 py-4 text-sm text-app-muted sm:px-6">{copy.ownerOnly}</p>
      ) : hasCommands ? (
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

function PlanCard({ workspaceId, planId, screen, intervals, choice, withOffers, customDomains }: {
  workspaceId: string;
  planId: PlanId;
  screen: PlanScreen;
  intervals: readonly BillingInterval[];
  choice: boolean;
  /** Some card offers something: every card keeps a row for it so the features line up. */
  withOffers: boolean;
  customDomains: boolean;
}) {
  const name = copy.planNames[planId];
  const isCurrent = planId === screen.currentPlan;
  const offer = screen.offers[planId];
  const saving = yearlySavingCents(planId);
  // Under a choice of interval each price and its button belong to one interval; CSS shows the chosen one.
  const intervalOf = (interval: BillingInterval) => (choice ? interval : undefined);
  return (
    <li className={`plan-card surface-card grid content-start gap-4 p-5 lg:grid-rows-subgrid ${withOffers ? "lg:row-span-4" : "lg:row-span-3"}`} aria-current={isCurrent ? "true" : undefined}>
      <div className="grid content-start gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold">{name}</h3>
          {isCurrent ? <Badge tone="accent">{copy.current.badge}</Badge> : null}
        </div>
        <p className="m-0 text-sm text-app-muted">{copy.planDescriptions[planId]}</p>
      </div>
      <div className="grid content-start gap-1">
        {isPaidPlan(planId) ? intervals.map((interval) => {
          const price = planPrice(planId, interval);
          return price ? (
            <div key={interval} className="grid gap-1" data-interval={intervalOf(interval)}>
              <p className="m-0 flex flex-wrap items-baseline gap-x-1.5"><span className="brand-display text-2xl font-bold">{formatMoney(price.amountCents)}</span><span className="text-sm text-app-muted">{copy.perInterval[interval]}</span></p>
              {interval === "year" && saving > 0 ? <p className="m-0 text-sm text-app-muted">{copy.yearlySaving(formatMoney(saving))}</p> : null}
            </div>
          ) : null;
        }) : (
          <>
            <p className="m-0"><span className="brand-display text-2xl font-bold">{copy.freePrice}</span></p>
            <p className="m-0 text-sm text-app-muted">{copy.plans.freeAlways}</p>
          </>
        )}
      </div>
      {/* Kept empty on wide screens so every card's features start on the same line. */}
      {withOffers ? <div className="grid content-start gap-2 max-lg:empty:hidden">
        {offer === "subscribe" ? intervals.map((interval) => {
          const price = planPrice(planId, interval);
          const label = copy.plans.subscribe(name, copy.intervalAdjective[interval]);
          return price ? (
            <div key={interval} data-interval={intervalOf(interval)}>
              <BillingActionForm action={startCheckoutAction.bind(null, workspaceId, planId, interval)} label={label} ariaLabel={`${label}: ${priceLabel(price.amountCents, interval)}`} />
            </div>
          ) : null;
        }) : null}
        {offer === "change" ? <Link className="ui-button ui-button-secondary w-full sm:w-auto sm:justify-self-start" href={`/app/w/${workspaceId}/plano/confirmar?acao=mudar&plano=${planId}`}>{copy.plans.changeTo(name)}</Link> : null}
      </div> : null}
      <div className="grid content-start gap-2 border-t border-app-border pt-4">
        <h4 className="text-sm font-semibold">{copy.plans.includes(name)}</h4>
        <ul className="m-0 grid list-disc gap-1 pl-5 text-sm marker:text-app-muted">
          {planFeatureLines(planId, { customDomains }).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
    </li>
  );
}

function Catalogue({ workspaceId, screen, customDomains }: { workspaceId: string; screen: PlanScreen; customDomains: boolean }) {
  const { prices } = screen;
  const choice = prices.kind === "choice";
  const intervals = prices.kind === "fixed" ? [prices.interval] : BILLING_INTERVALS;
  const withOffers = PLAN_IDS.some((planId) => screen.offers[planId] !== null);
  return (
    <section className="plan-catalogue grid gap-4" aria-labelledby="plans-title">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid gap-1">
          <h2 id="plans-title" className="text-xl font-bold">{copy.plans.title}</h2>
          <p className="m-0 text-app-muted">{copy.plans.lead}</p>
          {prices.kind === "fixed" ? <p className="m-0 text-sm text-app-muted">{copy.plans.pricesFor(copy.intervalAdjective[prices.interval])}</p> : null}
        </div>
        {/* Two native radios: the chosen interval's prices stay visible through CSS alone (globals.css). */}
        {prices.kind === "choice" ? (
          <fieldset className="plan-interval">
            <legend className="sr-only">{copy.plans.intervalLegend}</legend>
            {BILLING_INTERVALS.map((interval) => (
              <label key={interval}>
                <input type="radio" name="plan-interval" value={interval} defaultChecked={interval === prices.initial} />
                <span>{copy.intervals[interval]}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>
      <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-3">
        {PLAN_IDS.map((planId) => <PlanCard key={planId} workspaceId={workspaceId} planId={planId} screen={screen} intervals={intervals} choice={choice} withOffers={withOffers} customDomains={customDomains} />)}
      </ul>
      {screen.selling ? <p className="m-0 text-sm text-app-muted">{copy.provider}</p> : null}
    </section>
  );
}

const HISTORY_COLUMNS = "sm:grid-cols-[repeat(3,minmax(0,1fr))_8rem]";

/** One row per payment that reads on a phone without sideways scrolling: date and amount, then status and receipt. */
function PaymentHistory({ invoices }: { invoices: InvoiceView[] }) {
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
            <span>{columns.date}</span><span>{columns.amount}</span><span>{columns.status}</span><span>{columns.receipt}</span>
          </div>
          <ul className="m-0 list-none p-0">
            {invoices.map((invoice) => {
              const when = formatBillingDate(invoice.paidAt ?? invoice.issuedAt);
              return (
                <li key={invoice.id} className="border-b border-app-border py-2 last:border-0">
                  <dl className={`m-0 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 ${HISTORY_COLUMNS}`}>
                    <div><dt className="sr-only">{columns.date}</dt><dd className="m-0 tabular-nums"><time dateTime={invoice.paidAt ?? invoice.issuedAt}>{when}</time></dd></div>
                    <div className="text-right sm:text-left"><dt className="sr-only">{columns.amount}</dt><dd className="m-0 font-semibold">{formatMoney(invoice.amountCents)}</dd></div>
                    <div><dt className="sr-only">{columns.status}</dt><dd className="m-0"><Badge tone={INVOICE_TONE[invoice.status]}>{copy.history.status[invoice.status]}</Badge></dd></div>
                    <div className="text-right sm:text-left">
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
 * Plan and billing of one workspace (ADR 0014, UX-106). Server-rendered presentation of planScreen:
 * the route loads and authorizes, the actions re-authorize, and nothing here decides who may do what.
 * `data-plan-screen` hides the workspace's failing-payment banner here, where the card says the same
 * thing next to the way to fix it (globals.css).
 */
export function PlanScreenView({ workspaceId, screen, invoices, mode, deployed, suspended, customDomains, notice }: {
  workspaceId: string;
  screen: PlanScreen;
  invoices: InvoiceView[];
  mode: BillingMode;
  deployed: boolean;
  suspended: boolean;
  customDomains: boolean;
  notice: string | null;
}) {
  return (
    <div className="grid gap-6" data-plan-screen="">
      <PlanHeading lead />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {suspended ? <Notice tone="warning">{copy.suspended}</Notice> : null}
      <CurrentPlan workspaceId={workspaceId} screen={screen} />
      {/* About selling, not about this workspace's plan: right before the catalogue and its buttons. */}
      {mode === "sandbox" ? <Notice tone="warning">{copy.sandbox}</Notice> : null}
      {!deployed ? <Notice>{copy.notDeployed}</Notice> : mode === "off" ? <Notice>{copy.off}</Notice> : null}
      <Catalogue workspaceId={workspaceId} screen={screen} customDomains={customDomains} />
      {screen.showHistory ? <PaymentHistory invoices={invoices} /> : null}
    </div>
  );
}
