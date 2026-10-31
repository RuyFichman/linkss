import type { Metadata } from "next";
import { getCopy } from "@/modules/identity/locale";
import { PlanHeading, PlanScreenView } from "@/modules/billing/components/plan-screen";
import { resolveBillingMode } from "@/modules/billing/mode";
import { planScreen } from "@/modules/billing/plan-screen";
import type { WorkspaceBilling } from "@/modules/billing/read";
import type { WorkspaceUsage } from "@/modules/billing/downgrade-impact";
import { fetchWorkspaceBilling, fetchWorkspaceUsage } from "@/modules/billing/server";
import { domainsSignerFromEnv } from "@/modules/domains/config";
import { can } from "@/modules/identity/permissions";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { resolveAccount } from "@/modules/identity/session";
import { Notice } from "@/ui";

export async function generateMetadata(): Promise<Metadata> {
  const { BILLING_COPY } = await getCopy();
  return { title: BILLING_COPY.title };
}

/**
 * Plan and billing of one workspace (ADR 0014). Owners and admins see the plan and its state; only
 * the owner sees the payment history and the actions; editors are told who can. Everything shown
 * is what the database holds (a copy of the provider's state); the buttons are a convenience and
 * every command re-authorizes on the server and in the database. With billing off, or before the
 * migration, the screen shows the plan and the catalogue and offers nothing to buy. Usage (pages,
 * people, image space) is read with the viewer's session; owners and admins may read every count.
 */
export default async function PlanPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { BILLING_COPY } = await getCopy();
  const NOTICES = { cancelada: BILLING_COPY.confirm.canceled, mantida: BILLING_COPY.actions.resumed, alterada: BILLING_COPY.confirm.changedNow, agendada: BILLING_COPY.confirm.changedLater, anual: BILLING_COPY.confirm.changedInterval } as const;
  const { workspaceId } = await params;
  const asked = (await searchParams).aviso;
  // Only a known word becomes a sentence; the address decides nothing else.
  const notice = typeof asked === "string" && asked in NOTICES ? NOTICES[asked as keyof typeof NOTICES] : null;
  const copy = BILLING_COPY;
  const access = await authorizeWorkspacePage(workspaceId, "billing.view");
  if (!access) {
    return (
      <div className="grid gap-6">
        <PlanHeading copy={BILLING_COPY} />
        <p className="m-0 text-app-muted">{copy.forbidden}</p>
      </div>
    );
  }

  const isOwner = can(access.role, "billing.manage");
  const mode = resolveBillingMode().mode;
  let billing: WorkspaceBilling;
  // Usage is secondary: when it cannot be read the screen leaves it out instead of failing.
  const usage = fetchWorkspaceUsage(workspaceId).catch((): WorkspaceUsage | null => null);
  try {
    billing = await fetchWorkspaceBilling(workspaceId, isOwner);
  } catch {
    return (
      <div className="grid gap-6">
        <PlanHeading copy={BILLING_COPY} />
        <Notice tone="danger">{copy.loadError}</Notice>
      </div>
    );
  }
  const account = await resolveAccount();
  const suspended = account.status === "ready" && account.workspaces.find((item) => item.workspaceId === workspaceId)?.status === "suspended";
  const screen = planScreen({ billing, mode, isOwner, suspended, now: new Date(), usage: await usage }, BILLING_COPY);

  return <PlanScreenView copy={BILLING_COPY} workspaceId={workspaceId} screen={screen} invoices={billing.invoices} mode={mode} suspended={suspended} customDomains={domainsSignerFromEnv() !== null} notice={notice} />;
}
