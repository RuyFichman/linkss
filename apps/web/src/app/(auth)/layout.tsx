import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { copyFor } from "@/content/copy";
import { langAttribute } from "@/lib/locale";
import { getRequestLocale } from "@/modules/identity/locale";
import { LocaleProvider } from "@/ui/locale-context";
import { BrandLogo } from "@/ui/brand-logo";
import { BRAND_CLASS } from "@/ui/brand-font";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  const { APP_COPY } = copyFor(locale);
  return (
    <div className={BRAND_CLASS} lang={langAttribute(locale)}>
      <LocaleProvider locale={locale}>
      <a className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-app-surface focus:p-3" href="#conteudo">{APP_COPY.nav.skipToContent}</a>
      <header className="app-shell flex min-h-16 items-center justify-between gap-4">
        <Link className="app-brand" href="/"><BrandLogo /></Link>
      </header>
      <main id="conteudo" className="app-shell grid place-items-center py-6 sm:py-14">
        <div className="surface-card w-full max-w-md p-5 sm:p-8">{children}</div>
      </main>
      </LocaleProvider>
    </div>
  );
}
