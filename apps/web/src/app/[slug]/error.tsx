"use client";

import { PUBLIC_PAGE_COPY } from "@/content/pt-BR";

/**
 * Only reached when a page has never rendered successfully: once cached, ISR keeps serving the last
 * good version while regeneration fails. The server error is logged by instrumentation.ts.
 */
export default function PublicPageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-app-bg px-4 text-center text-app-text">
      <div className="grid max-w-md justify-items-center gap-3">
        <h1 className="m-0 text-2xl font-bold">{PUBLIC_PAGE_COPY.errorTitle}</h1>
        <p className="m-0 text-app-muted">{PUBLIC_PAGE_COPY.error}</p>
        <button type="button" className="ui-button ui-button-primary" onClick={reset}>{PUBLIC_PAGE_COPY.retry}</button>
      </div>
    </main>
  );
}
