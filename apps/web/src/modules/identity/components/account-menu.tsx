import Link from "next/link";
import { APP_COPY, AUTH_COPY } from "@/content/pt-BR";
import { signOutAction } from "../actions";

/**
 * Account links behind one button, so the header stays on a single row on phones. A `details`
 * element: it opens without JavaScript, and sign-out stays a POST (Server Action).
 */
export function AccountMenu() {
  return (
    <details className="relative flex-none">
      <summary className="ui-button ui-button-secondary cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {/* An icon on phones, so the workspace name beside it has room to be read. */}
        <svg className="size-5 sm:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
        <span className="max-sm:sr-only">{APP_COPY.nav.account}</span>
        <span aria-hidden="true">▾</span>
      </summary>
      <div className="absolute right-0 z-40 mt-2 grid w-60 max-w-[calc(100vw-2rem)] gap-1 rounded-2xl border border-app-border bg-app-surface p-2 shadow-raised">
        <Link href="/app/conta/dados" className="flex min-h-11 items-center rounded-xl px-3 py-2 no-underline hover:bg-app-surface-soft">{APP_COPY.nav.myData}</Link>
        <Link href="/ajuda" className="flex min-h-11 items-center rounded-xl px-3 py-2 no-underline hover:bg-app-surface-soft">{APP_COPY.nav.help}</Link>
        <form action={signOutAction} className="border-t border-app-border pt-1">
          <button type="submit" className="flex min-h-11 w-full cursor-pointer items-center rounded-xl border-0 bg-transparent px-3 py-2 text-left hover:bg-app-surface-soft">{AUTH_COPY.signOut}</button>
        </form>
      </div>
    </details>
  );
}
