import type { Metadata } from "next";
import Link from "next/link";
import { PUBLIC_PAGE_COPY } from "@/content/pt-BR";

export const metadata: Metadata = { title: { absolute: PUBLIC_PAGE_COPY.notFoundTitle }, robots: { index: false, follow: false } };

/** Site-wide 404, also used for unpublished public pages (no hint that a draft exists). */
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-app-bg px-4 text-center text-app-text">
      <div className="grid max-w-md justify-items-center gap-3">
        <h1 className="m-0 text-2xl font-bold">{PUBLIC_PAGE_COPY.notFoundTitle}</h1>
        <p className="m-0 text-app-muted">{PUBLIC_PAGE_COPY.notFound}</p>
        <Link className="ui-button ui-button-secondary" href="/">{PUBLIC_PAGE_COPY.goHome}</Link>
      </div>
    </main>
  );
}
