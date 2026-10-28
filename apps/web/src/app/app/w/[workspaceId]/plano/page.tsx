import type { Metadata } from "next";
import { BILLING_COPY } from "@/content/pt-BR";
import { PlanHeading, PlanScreenView } from "@/modules/billing/components/plan-screen";
import { resolveBillingMode } from "@/modules/billing/mode";
import { planScreen } from "@/modules/billing/plan-screen";
import type { WorkspaceBilling } from "@/modules/billing/read";
import { fetchWorkspaceBilling } from "@/modules/billing/server";
import { domainsSignerFromEnv } from "@/modules/domains/config";
import { can } from "@/modules/identity/permissions";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { resolveAccount } from "@/modules/identity/session";
import { Notice } from "@/ui";

export const metadata: Metadata = { title: BILLING_COPY.title };

/**
 * Plan and billing of one workspace (ADR 0014). Owners and admins see the plan and its state; only
 * the owner sees the payment history and the actions; editors are told who can. Everything shown
 * is what the database holds (a copy of the provider's state); the buttons are a convenience and
 * every command re-authorizes on the server and in the database. With billing off, or before the
 * migration, the screen shows the plan and the catalogue and offers nothing to buy.
 */
const NOTICES = { cancelada: BILLING_COPY.confirm.canceled, mantida: BILLING_COPY.actions.resumed, alterada: BILLING_COPY.confirm.changedNow, agendada: BILLING_COPY.confirm.changedLater, anual: BILLING_COPY.confirm.changedInterval } as const;

export default async function PlanPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspaceId } = await params;
  const asked = (await searchParams).aviso;
  // Only a known word becomes a sentence; the address decides nothing else.
  const notice = typeof asked === "string" && asked in NOTICES ? NOTICES[asked as keyof typeof NOTICES] : null;
  const copy = BILLING_COPY;
  const access = await authorizeWorkspacePage(workspaceId, "billing.view");
  if (!access) {
    return (
      <div className="grid gap-6">
        <PlanHeading />
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
      <div className="grid gap-6">
        <PlanHeading />
        <Notice tone="danger">{copy.loadError}</Notice>
      </div>
    );
  }
  const account = await resolveAccount();
  const suspended = account.status === "ready" && account.workspaces.find((item) => item.workspaceId === workspaceId)?.status === "suspended";
  const screen = planScreen({ billing, mode, isOwner, suspended, now: new Date() });

  return <PlanScreenView workspaceId={workspaceId} screen={screen} invoices={billing.invoices} mode={mode} deployed={billing.deployed} suspended={suspended} customDomains={domainsSignerFromEnv() !== null} notice={notice} />;
}
