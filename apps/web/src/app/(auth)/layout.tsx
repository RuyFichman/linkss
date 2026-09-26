import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { PRODUCT } from "@/lib/product";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <a className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-app-surface focus:p-3" href="#conteudo">{APP_COPY.nav.skipToContent}</a>
      <header className="app-shell flex min-h-16 items-center justify-between gap-4">
        <Link className="inline-flex min-h-11 items-center font-bold" href="/">{PRODUCT.codename}</Link>
        <span className="ui-badge ui-badge-warning">Nome provisório</span>
      </header>
      <main id="conteudo" className="app-shell grid place-items-center py-8 sm:py-14">
        <div className="surface-card w-full max-w-md p-6 sm:p-8">{children}</div>
      </main>
    </div>
  );
}
