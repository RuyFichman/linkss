import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { copyFor } from "@/content/copy";
import { langAttribute } from "@/lib/locale";
import { getRequestLocale } from "@/modules/identity/locale";
import { PRODUCT } from "@/lib/product";
import { AccountMenu } from "@/modules/identity/components/account-menu";
import { WorkspaceSwitcher } from "@/modules/identity/components/workspace-switcher";
import { resolveAccount } from "@/modules/identity/session";
import { legalAcceptanceRequired } from "@/modules/legal/server";
import { EmptyState } from "@/ui";
import { BRAND_CLASS } from "@/ui/brand-font";
import { BrandLogo } from "@/ui/brand-logo";
import { LocaleProvider } from "@/ui/locale-context";

export async function generateMetadata(): Promise<Metadata> {
  const { APP_COPY } = copyFor(await getRequestLocale());
  return { title: { default: APP_COPY.nav.dashboardTitle, template: `%s | ${PRODUCT.name}` }, robots: { index: false, follow: false } };
}

/** Authenticated shell. Identity and workspaces are resolved on the server for every request. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const account = await resolveAccount();
  if (account.status === "anonymous") redirect("/entrar?next=/app");
  if (account.status === "ready" && await legalAcceptanceRequired()) redirect("/aceite");
  const locale = await getRequestLocale();
  const { APP_COPY } = copyFor(locale);

  return (
    <div className={BRAND_CLASS} lang={langAttribute(locale)}>
      <LocaleProvider locale={locale}>
      <a className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-app-surface focus:p-3" href="#conteudo">{APP_COPY.nav.skipToContent}</a>
      {/* `data-app-chrome` steps aside while the page editor fills the viewport (studio.css). */}
      <header data-app-chrome="">
        <div className="app-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link className="app-brand" href="/app"><BrandLogo /></Link>
            {account.status === "ready" ? <WorkspaceSwitcher workspaces={account.workspaces.map((workspace) => ({ id: workspace.workspaceId, name: workspace.name, kind: workspace.kind, role: workspace.role }))} /> : null}
          </div>
          <AccountMenu />
        </div>
      </header>
      <main id="conteudo" className="app-shell py-6 sm:py-10">
        {account.status === "ready" ? children : (
          <EmptyState title={APP_COPY.workspace.preparingError} description={APP_COPY.errors.unavailable} action={<Link className="ui-button ui-button-primary" href="/app">{APP_COPY.workspace.retry}</Link>} />
        )}
      </main>
      </LocaleProvider>
    </div>
  );
}
