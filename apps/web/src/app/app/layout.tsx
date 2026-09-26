import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { PRODUCT } from "@/lib/product";
import { SignOutButton } from "@/modules/identity/components/sign-out-button";
import { WorkspaceSwitcher } from "@/modules/identity/components/workspace-switcher";
import { resolveAccount } from "@/modules/identity/session";
import { EmptyState } from "@/ui";

export const metadata: Metadata = { title: { default: "Painel", template: `%s | ${PRODUCT.codename}` }, robots: { index: false, follow: false } };

/** Authenticated shell. Identity and workspaces are resolved on the server for every request. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const account = await resolveAccount();
  if (account.status === "anonymous") redirect("/entrar?next=/app");

  return (
    <div className="min-h-screen">
      <a className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-app-surface focus:p-3" href="#conteudo">{APP_COPY.nav.skipToContent}</a>
      <header className="border-b border-app-border bg-app-surface">
        <div className="app-shell flex min-h-16 flex-wrap items-center justify-between gap-3 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <Link className="inline-flex min-h-11 items-center font-bold" href="/app">{PRODUCT.codename}</Link>
            {account.status === "ready" ? <WorkspaceSwitcher workspaces={account.workspaces.map((workspace) => ({ id: workspace.workspaceId, name: workspace.name, kind: workspace.kind, role: workspace.role }))} /> : null}
          </div>
          <SignOutButton />
        </div>
      </header>
      <main id="conteudo" className="app-shell py-8 sm:py-12">
        {account.status === "ready" ? children : (
          <EmptyState title={APP_COPY.workspace.preparingError} description={APP_COPY.errors.unavailable} action={<Link className="ui-button ui-button-primary" href="/app">{APP_COPY.workspace.retry}</Link>} />
        )}
      </main>
    </div>
  );
}
