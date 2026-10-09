import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BILLING_COPY } from "@/content/pt-BR";
import type { PlanId } from "@/lib/product";
import { cancelSubscriptionAction, changePlanAction } from "@/modules/billing/actions";
import { formatMoney, isPaidPlan, isPlanId, planPrice, planRank } from "@/modules/billing/catalog";
import { BillingActionForm } from "@/modules/billing/components/billing-action-form";
import { downgradeImpact, hasImpact, type ImpactItem } from "@/modules/billing/downgrade-impact";
import { resolveBillingMode } from "@/modules/billing/mode";
import { formatBillingDate, impactSentence, planFeatureLines } from "@/modules/billing/presentation";
import { fetchWorkspaceBilling, fetchWorkspaceUsage } from "@/modules/billing/server";
import { availableBillingActions, billingViewState } from "@/modules/billing/subscription";
import { planEntitlementsFromProduct } from "@/modules/entitlements";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { Badge, Notice } from "@/ui";

export const metadata: Metadata = { title: BILLING_COPY.confirm.impactTitle };

const KIND_TONE = { kept: "success", blocked: "warning", stops: "danger" } as const;

/**
 * The step before a cancellation or a plan change (ADR 0014, AC3). It lists, with this workspace's
 * real numbers, what stays, what goes above a limit and what stops working, and only then offers
 * the button. The list comes from the same pure function the tests cover; nothing is deleted by
 * any of these changes. Owner only: other roles get the sentence that says who can.
 */
export default async function ConfirmPlanChangePage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const copy = BILLING_COPY;
  const base = `/app/w/${workspaceId}/plano`;
  const back = <Link className="ui-button ui-button-secondary" href={base}>{copy.confirm.keep}</Link>;
  const frame = (title: string, children: React.ReactNode) => (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-3xl font-bold">{title}</h1>
      {children}
    </div>
  );

  const access = await authorizeWorkspacePage(workspaceId, "billing.manage");
  if (!access) return frame(copy.title, <p className="m-0 text-app-muted">{copy.ownerOnly}</p>);

  const action = typeof query.acao === "string" ? query.acao : "";
  const targetParam = typeof query.plano === "string" ? query.plano : "";
  if (action !== "cancelar" && action !== "mudar") notFound();
  if (action === "mudar" && !(isPlanId(targetParam) && isPaidPlan(targetParam))) notFound();
  const target: PlanId = action === "cancelar" ? "free" : (targetParam as PlanId);

  const mode = resolveBillingMode().mode;
  let billing: Awaited<ReturnType<typeof fetchWorkspaceBilling>>;
  let usage: Awaited<ReturnType<typeof fetchWorkspaceUsage>>;
  try {
    [billing, usage] = await Promise.all([fetchWorkspaceBilling(workspaceId, true), fetchWorkspaceUsage(workspaceId)]);
  } catch {
    return frame(copy.title, <><Notice tone="danger">{copy.loadError}</Notice><div>{back}</div></>);
  }
  if (mode === "off" || !billing.deployed) return frame(copy.title, <><Notice>{billing.deployed ? copy.off : copy.notDeployed}</Notice><div>{back}</div></>);

  const record = billing.record;
  const state = billingViewState(record, billing.planId, new Date());
  const allowed = availableBillingActions(state);
  // What the workspace is charged for today (after a scheduled change it differs from the plan in force).
  const charged: PlanId | null = record && (record.status === "active" || record.status === "past_due") ? record.planId : null;
  const possible = record && charged && (action === "cancelar" ? allowed.cancel : allowed.changePlan && target !== charged && planPrice(target, record.interval) !== null);
  if (!record || !charged || !possible) return frame(copy.title, <><Notice tone="warning">{copy.confirm.notAvailable}</Notice><div>{back}</div></>);

  const inForce: PlanId = state.kind === "free" || state.kind === "ended" ? "free" : state.planId;
  const isUpgrade = planRank(target) > planRank(inForce);
  const price = planPrice(target, record.interval);
  const items: ImpactItem[] = isUpgrade ? [] : downgradeImpact(usage, planEntitlementsFromProduct(inForce), planEntitlementsFromProduct(target));
  const periodEnd = formatBillingDate(record.currentPeriodEnd);
  const targetName = copy.planNames[target];
  const title = action === "cancelar" ? copy.confirm.cancelTitle : copy.confirm.changeTitle(targetName);
  const lead = action === "cancelar"
    ? (periodEnd ? copy.confirm.cancelLead(copy.planNames[inForce], periodEnd) : copy.confirm.cancelLeadNoDate(copy.planNames[inForce]))
    : isUpgrade && price
      ? copy.confirm.upgradeLead(formatMoney(price.amountCents), copy.perInterval[record.interval])
      : price ? copy.confirm.downgradeLead(copy.planNames[inForce], targetName, periodEnd, formatMoney(price.amountCents), copy.perInterval[record.interval]) : "";

  return frame(title, (
    <>
      {mode === "sandbox" ? <Notice tone="warning">{copy.sandbox}</Notice> : null}
      <p className="m-0">{lead}</p>

      {isUpgrade ? (
        <section className="surface-card grid gap-3 p-5 sm:p-6" aria-labelledby="gains-title">
          <h2 id="gains-title" className="text-xl font-bold">{copy.confirm.gainsTitle}</h2>
          <ul className="m-0 grid list-disc gap-1 pl-5">{planFeatureLines(target).map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
      ) : (
        <section className="surface-card grid gap-4 p-5 sm:p-6" aria-labelledby="impact-title">
          <h2 id="impact-title" className="text-xl font-bold">{copy.confirm.impactTitle}</h2>
          {hasImpact(items) ? null : <p className="m-0">{copy.confirm.noImpact}</p>}
          <ul className="m-0 grid list-none gap-3 p-0">
            {/* What changes first; each line starts with its kind in words, never colour alone. */}
            {[...items].sort((a, b) => Number(a.kind === "kept") - Number(b.kind === "kept")).map((item) => (
              <li key={item.key} className="grid gap-1 rounded-2xl border border-app-border p-4">
                <span><Badge tone={KIND_TONE[item.kind]}>{copy.impact.kind[item.kind]}</Badge></span>
                <span>{impactSentence(item)}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 font-bold">{copy.confirm.nothingDeleted}</p>
        </section>
      )}

      <div className="flex flex-wrap items-start gap-3">
        {action === "cancelar"
          ? <BillingActionForm action={cancelSubscriptionAction.bind(null, workspaceId)} label={copy.confirm.confirmCancel} variant="danger" hideOnSuccess />
          : <BillingActionForm action={changePlanAction.bind(null, workspaceId, target)} label={copy.confirm.confirmChange(targetName)} variant="primary" hideOnSuccess />}
        <Link className="ui-button ui-button-secondary" href={base}>{copy.actions.back}</Link>
      </div>
    </>
  ));
}
