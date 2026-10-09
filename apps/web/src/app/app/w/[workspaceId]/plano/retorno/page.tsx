import type { Metadata } from "next";
import Link from "next/link";
import { BILLING_COPY } from "@/content/pt-BR";
import { BillingRefresher } from "@/modules/billing/components/billing-refresher";
import { resolveBillingMode } from "@/modules/billing/mode";
import { fetchWorkspaceBilling } from "@/modules/billing/server";
import { billingViewState } from "@/modules/billing/subscription";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { Notice } from "@/ui";

export const metadata: Metadata = { title: BILLING_COPY.return.title, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/**
 * Where the provider's checkout sends the person back (ADR 0014). This page grants nothing and
 * trusts nothing in its address: opening the "success" address without paying shows the waiting
 * state forever, because what it renders is what the database holds, and the database changes only
 * through a verified snapshot of the provider's state. While that has not arrived the page asks
 * again by itself; it never says a payment went through unless the plan is already in force.
 */
export default async function CheckoutReturnPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const copy = BILLING_COPY;
  const base = `/app/w/${workspaceId}/plano`;
  const frame = (children: React.ReactNode) => (
    <div className="grid max-w-2xl gap-5">
      <h1 className="text-3xl font-bold">{copy.return.title}</h1>
      {resolveBillingMode().mode === "sandbox" ? <Notice tone="warning">{copy.sandbox}</Notice> : null}
      {children}
    </div>
  );
  const toPlan = (label: string) => <div><Link className="ui-button ui-button-primary" href={base}>{label}</Link></div>;

  const access = await authorizeWorkspacePage(workspaceId, "billing.view");
  if (!access) return frame(<p className="m-0 text-app-muted">{copy.forbidden}</p>);

  if (query.resultado === "cancelado") return frame(<><Notice>{copy.return.canceled}</Notice>{toPlan(copy.return.tryAgain)}</>);

  let billing: Awaited<ReturnType<typeof fetchWorkspaceBilling>>;
  try {
    billing = await fetchWorkspaceBilling(workspaceId, false);
  } catch {
    return frame(<><Notice tone="danger">{copy.loadError}</Notice><div><Link className="ui-button ui-button-secondary" href={`${base}/retorno?resultado=sucesso`}>{copy.return.checkNow}</Link></div></>);
  }
  const state = billingViewState(billing.record, billing.planId, new Date());

  if (state.kind === "active" || state.kind === "canceling" || state.kind === "downgrading") {
    return frame(<><Notice tone="success">{copy.return.confirmed(copy.planNames[state.planId])}</Notice>{toPlan(copy.return.backToPlan)}</>);
  }
  if (state.kind === "incomplete") {
    return frame(
      <>
        <Notice tone="warning">{copy.return.pending(copy.planNames[state.planId])}</Notice>
        <BillingRefresher waiting={copy.return.waiting} stillWaiting={copy.return.stillWaiting} />
        {toPlan(copy.return.backToPlan)}
      </>,
    );
  }
  // Nothing recorded yet: the provider's confirmation has not arrived (or nobody paid).
  return frame(
    <>
      <h2 className="text-xl font-bold">{copy.return.waitingTitle}</h2>
      <BillingRefresher waiting={copy.return.waiting} stillWaiting={copy.return.stillWaiting} />
      <div className="flex flex-wrap gap-3">
        <Link className="ui-button ui-button-secondary" href={`${base}/retorno?resultado=sucesso`}>{copy.return.checkNow}</Link>
        <Link className="ui-button ui-button-secondary" href={base}>{copy.return.backToPlan}</Link>
      </div>
    </>,
  );
}
