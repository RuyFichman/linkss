import type { Metadata } from "next";
import Link from "next/link";
import { BILLING_COPY } from "@/content/pt-BR";
import type { PlanId } from "@/lib/product";
import { openSelfServiceAction, resumeSubscriptionAction, startCheckoutAction } from "@/modules/billing/actions";
import { BILLING_INTERVALS, PLAN_IDS, formatMoney, isPaidPlan, planPrice, planRank, yearlySavingCents } from "@/modules/billing/catalog";
import { BillingActionForm } from "@/modules/billing/components/billing-action-form";
import { resolveBillingMode } from "@/modules/billing/mode";
import { billingStateSentence, formatBillingDate, planFeatureLines, priceLabel } from "@/modules/billing/presentation";
import type { WorkspaceBilling } from "@/modules/billing/read";
import { fetchWorkspaceBilling } from "@/modules/billing/server";
import { availableBillingActions, billingViewState, type BillingViewState } from "@/modules/billing/subscription";
import { can } from "@/modules/identity/permissions";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { resolveAccount } from "@/modules/identity/session";
import { Badge, Notice } from "@/ui";
import { ConfirmDialog } from "@/ui/confirm-dialog";

export const metadata: Metadata = { title: BILLING_COPY.title };

const STATE_TONE: Record<BillingViewState["kind"], "neutral" | "success" | "warning" | "danger" | "accent"> = {
  free: "neutral", manual: "accent", incomplete: "warning", active: "success", canceling: "warning", downgrading: "warning", past_due: "danger", grace_expired: "danger", ended: "neutral",
};

/**
 * Plan and billing of one workspace (ADR 0014). Owners and admins see the plan and its state; only
 * the owner sees the payment history and the actions; editors are told who can. Everything shown
 * is what the database holds (a copy of the provider's state); the buttons are a convenience and
 * every command re-authorizes on the server and in the database. With billing off, or before the
 * migration, the screen shows the plan and the catalogue and offers nothing to buy.
 */
export default async function PlanPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const copy = BILLING_COPY;
  const access = await authorizeWorkspacePage(workspaceId, "billing.view");
  if (!access) {
    return (
      <div className="grid gap-4">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="m-0 text-app-muted">{copy.forbidden}</p>
      </div>
    );
  }

  const isOwner = can(access.role, "billing.manage");
  const mode = resolveBillingMode().mode;
  let billing: WorkspaceBilling;
  try {
    billing = await fetchWorkspaceBilling(workspaceId, isOwner);
  } catch {
    return (
      <div className="grid gap-4">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <Notice tone="danger">{copy.loadError}</Notice>
      </div>
    );
  }
  const account = await resolveAccount();
  const suspended = account.status === "ready" && account.workspaces.find((item) => item.workspaceId === workspaceId)?.status === "suspended";
  const selling = mode !== "off" && billing.deployed;
  const state = billingViewState(billing.record, billing.planId, new Date());
  const actions = availableBillingActions(state);
  const base = `/app/w/${workspaceId}/plano`;
  const currentPlan: PlanId = state.kind === "free" || state.kind === "ended" ? "free" : state.planId;
  const subscribedInterval = billing.record && (state.kind === "active" || state.kind === "downgrading") ? billing.record.interval : null;
  // The plan the subscription is charged for: after a scheduled change to a cheaper plan it differs from the plan in force.
  const chargedPlan: PlanId | null = state.kind === "downgrading" ? state.nextPlanId : state.kind === "active" ? state.planId : null;

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="m-0 text-app-muted">{copy.lead}</p>
      </header>

      {mode === "sandbox" ? <Notice tone="warning">{copy.sandbox}</Notice> : null}
      {!billing.deployed ? <Notice>{copy.notDeployed}</Notice> : mode === "off" ? <Notice>{copy.off}</Notice> : null}
      {suspended ? <Notice tone="warning">{copy.suspended}</Notice> : null}

      <section className="surface-card grid gap-4 p-5 sm:p-6" aria-labelledby="current-plan-title">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="current-plan-title" className="text-xl font-bold">{copy.current.title}</h2>
          <Badge tone="accent">{copy.planNames[currentPlan]}</Badge>
          <Badge tone={STATE_TONE[state.kind]}>{copy.statusLabel[state.kind]}</Badge>
        </div>
        <p className="m-0">{billingStateSentence(state, billing.amountCents)}</p>
        {isOwner ? (
          selling ? (
            <div className="flex flex-wrap items-start gap-3">
              {actions.fixPayment && selling ? <BillingActionForm action={openSelfServiceAction.bind(null, workspaceId)} label={copy.actions.fixPayment} /> : null}
              {actions.resume && selling && billing.record ? (
                <ConfirmDialog action={resumeSubscriptionAction.bind(null, workspaceId)} openLabel={copy.actions.resume} openVariant="secondary" title={copy.actions.resumeTitle} confirmLabel={copy.actions.resumeConfirm} cancelLabel={copy.actions.resumeCancel}>
                  <p className="m-0 text-app-muted">{copy.actions.resumeBody(copy.planNames[billing.record.planId])}</p>
                </ConfirmDialog>
              ) : null}
              {(actions.changePlan || actions.cancel) && selling && !actions.fixPayment ? <BillingActionForm action={openSelfServiceAction.bind(null, workspaceId)} label={copy.actions.managePayment} variant="secondary" /> : null}
              {actions.cancel ? <Link className="ui-button ui-button-secondary" href={`${base}/confirmar?acao=cancelar`}>{copy.actions.cancel}</Link> : null}
            </div>
          ) : null
        ) : <p className="m-0 text-sm text-app-muted">{copy.ownerOnly}</p>}
      </section>

      <section className="grid gap-4" aria-labelledby="plans-title">
        <div className="grid gap-1">
          <h2 id="plans-title" className="text-xl font-bold">{copy.plans.title}</h2>
          <p className="m-0 text-app-muted">{copy.plans.lead}</p>
          {selling ? <p className="m-0 text-sm text-app-muted">{copy.provider}</p> : null}
          {selling && isOwner && state.kind === "manual" ? <p className="m-0 text-sm text-app-muted">{copy.plans.replacesManual}</p> : null}
          {subscribedInterval ? <p className="m-0 text-sm text-app-muted">{copy.plans.intervalFixed(copy.intervalAdjective[subscribedInterval])}</p> : null}
        </div>
        <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-3">
          {PLAN_IDS.map((planId) => {
            const name = copy.planNames[planId];
            const isCurrent = planId === currentPlan;
            const paid = isPaidPlan(planId);
            const saving = yearlySavingCents(planId);
            return (
              <li key={planId} className="surface-card grid content-start gap-4 p-5" aria-current={isCurrent ? "true" : undefined}>
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold">{name}</h3>
                    {isCurrent ? <Badge tone="accent">{copy.current.badge}</Badge> : null}
                  </div>
                  <p className="m-0 text-sm text-app-muted">{copy.planDescriptions[planId]}</p>
                </div>
                {paid ? (
                  <div className="grid gap-1">
                    {BILLING_INTERVALS.map((interval) => {
                      const price = planPrice(planId, interval);
                      return price ? <p key={interval} className="m-0"><b className="text-lg">{formatMoney(price.amountCents)}</b> <span className="text-app-muted">{copy.perInterval[interval]}</span></p> : null;
                    })}
                    {saving > 0 ? <p className="m-0 text-sm text-app-muted">{copy.yearlySaving(formatMoney(saving))}</p> : null}
                  </div>
                ) : (
                  <div className="grid gap-1">
                    <p className="m-0"><b className="text-lg">{copy.freePrice}</b></p>
                    <p className="m-0 text-sm text-app-muted">{copy.plans.freeAlways}</p>
                  </div>
                )}
                <div className="grid gap-2">
                  <h4 className="text-sm font-bold">{copy.plans.includes(name)}</h4>
                  <ul className="m-0 grid list-disc gap-1 pl-5 text-sm">
                    {planFeatureLines(planId).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </div>
                {selling && isOwner && !suspended && paid ? (
                  <div className="grid gap-2">
                    {actions.subscribe ? BILLING_INTERVALS.map((interval) => {
                      const price = planPrice(planId, interval);
                      return price ? (
                        <BillingActionForm key={interval} action={startCheckoutAction.bind(null, workspaceId, planId, interval)} variant={interval === "month" ? "primary" : "secondary"}
                          label={`${copy.plans.subscribe(name, copy.intervalAdjective[interval])}: ${priceLabel(price.amountCents, interval)}`} />
                      ) : null;
                    }) : null}
                    {actions.changePlan && chargedPlan && planId !== chargedPlan && planRank(planId) !== planRank(chargedPlan) ? (
                      <Link className="ui-button ui-button-secondary" href={`${base}/confirmar?acao=mudar&plano=${planId}`}>{copy.plans.changeTo(name)}</Link>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {selling && !isOwner ? <p className="m-0 text-sm text-app-muted">{copy.ownerOnly}</p> : null}
      </section>

      {isOwner && billing.deployed ? (
        <section className="surface-card grid grid-cols-[minmax(0,1fr)] gap-4 p-5 sm:p-6" aria-labelledby="payments-title">
          <div className="grid gap-1">
            <h2 id="payments-title" className="text-xl font-bold">{copy.history.title}</h2>
            <p className="m-0 text-sm text-app-muted">{copy.history.lead}</p>
          </div>
          {billing.invoices.length === 0 ? <p className="m-0 text-app-muted">{copy.history.empty}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-app-border text-app-muted">
                    <th scope="col" className="py-2 pr-4 font-bold">{copy.history.columns.date}</th>
                    <th scope="col" className="py-2 pr-4 font-bold">{copy.history.columns.amount}</th>
                    <th scope="col" className="py-2 pr-4 font-bold">{copy.history.columns.status}</th>
                    <th scope="col" className="py-2 font-bold">{copy.history.columns.receipt}</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.invoices.map((invoice) => {
                    const when = formatBillingDate(invoice.paidAt ?? invoice.issuedAt);
                    return (
                      <tr key={invoice.id} className="border-b border-app-border last:border-0">
                        <td className="py-2 pr-4">{when}</td>
                        <td className="py-2 pr-4">{formatMoney(invoice.amountCents)}</td>
                        <td className="py-2 pr-4">{copy.history.status[invoice.status]}</td>
                        <td className="py-2">
                          {invoice.receiptUrl
                            ? <a className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href={invoice.receiptUrl} target="_blank" rel="noopener noreferrer" aria-label={copy.history.receiptFor(when)}>{copy.history.receipt}</a>
                            : <span className="text-app-muted">{copy.history.noReceipt}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
