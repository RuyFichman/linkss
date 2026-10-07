import Link from "next/link";
import type { ReactNode } from "react";
import { APP_COPY } from "@/content/pt-BR";
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
      {workspace ? (
        <div data-app-chrome="" className="mb-6 flex flex-wrap items-center gap-2 text-sm text-app-muted">
          <span>{workspace.kind === "personal" ? APP_COPY.workspace.personalLabel : APP_COPY.workspace.agencyLabel}</span>
          {workspace.kind === "agency" ? <><span aria-hidden="true">•</span><b className="text-app-text">{workspaceLabel(workspace)}</b><Badge tone="accent">{APP_COPY.roles[workspace.role]}</Badge></> : null}
        </div>
      ) : null}
      {workspace ? (
        <nav data-app-chrome="" aria-label={APP_COPY.nav.workspace} className="mb-6 flex flex-wrap gap-x-5 border-b border-app-border">
          <Link className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href={`/app/w/${workspaceId}`}>{APP_COPY.nav.pages}</Link>
          <Link className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href={`/app/w/${workspaceId}/resultados`}>{APP_COPY.nav.results}</Link>
          <Link className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href={`/app/w/${workspaceId}/membros`}>{APP_COPY.nav.members}</Link>
        </nav>
      ) : null}
      {workspace?.status === "suspended" ? <div className="mb-6"><Notice tone="warning">Esta conta está suspensa. Você pode consultar as páginas, mas não alterá-las. Fale com o suporte.</Notice></div> : null}
      {children}
    </>
  );
}
