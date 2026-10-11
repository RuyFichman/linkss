import type { ReactNode } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { BillingBanner } from "@/modules/billing/components/billing-banner";
import { WorkspaceNav } from "@/modules/identity/components/workspace-nav";
import { SuspendedPagesNotice } from "@/modules/moderation/components/suspended-pages-notice";
import { can } from "@/modules/identity/permissions";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { resolveAccount } from "@/modules/identity/session";
import { workspaceLabel } from "@/modules/identity/workspace-label";
import { Badge, Notice } from "@/ui";

/** Every request re-checks membership; a workspace the person does not belong to is a 404. */
export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await authorizeWorkspacePage(workspaceId, "workspace.view");
  const account = await resolveAccount();
  const workspace = account.status === "ready" ? account.workspaces.find((item) => item.workspaceId === workspaceId) : undefined;

  return (
    <>
      {/* The personal workspace is already named by the switcher in the header. */}
      {workspace?.kind === "agency" ? (
        <div data-app-chrome="" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-app-muted">
          <span>{APP_COPY.workspace.agencyLabel}</span>
          <span aria-hidden="true">•</span><b className="text-app-text">{workspaceLabel(workspace)}</b><Badge tone="accent">{APP_COPY.roles[workspace.role]}</Badge>
        </div>
      ) : null}
      {workspace ? <WorkspaceNav workspaceId={workspaceId} showPlan={can(workspace.role, "billing.view")} /> : null}
      {workspace ? <BillingBanner workspaceId={workspaceId} role={workspace.role} /> : null}
      {workspace ? <SuspendedPagesNotice workspaceId={workspaceId} /> : null}
      {workspace?.status === "suspended" ? <div className="mb-6"><Notice tone="warning">Esta conta está suspensa. Você pode consultar as páginas, mas não alterá-las. Fale com o suporte.</Notice></div> : null}
      {children}
    </>
  );
}
