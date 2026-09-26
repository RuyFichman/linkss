import Link from "next/link";
import { PUBLIC_PAGE_COPY } from "@/content/pt-BR";
import { PRODUCT } from "@/lib/product";
import { initialsFor } from "@/modules/profiles/content";
import type { PublishedDocument } from "../document";
import { SOCIAL_NETWORKS } from "../social";
import { SocialIcon } from "./social-icon";

/**
 * Public page markup for a published (or preview) document. Pure server-rendered HTML with plain
 * anchors: every link works without JavaScript, so a failing analytics/telemetry script cannot
 * break navigation. Links are user content, hence rel="ugc nofollow".
 */
export function PublicPageView({ document, showBadge, as: Root = "main" }: { document: PublishedDocument; showBadge: boolean; as?: "main" | "div" }) {
  return (
    <Root className="min-h-screen bg-app-bg px-4 py-10 text-app-text sm:py-14">
      <article className="mx-auto grid w-full max-w-md gap-6 text-center">
        <header className="grid justify-items-center gap-3">
          {/* Sprint 5 replaces the initials with the uploaded avatar (sized, no layout shift). */}
          <span aria-hidden="true" className="grid h-24 w-24 place-items-center rounded-full bg-app-accent text-3xl font-bold text-white">{initialsFor(document.title)}</span>
          <h1 className="m-0 text-2xl font-bold leading-tight break-words sm:text-3xl">{document.title}</h1>
          {document.bio ? <p className="m-0 max-w-prose whitespace-pre-line break-words leading-relaxed text-app-muted">{document.bio}</p> : null}
          {document.socialLinks.length > 0 ? (
            <nav aria-label={PUBLIC_PAGE_COPY.socialLabel}>
              <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
                {document.socialLinks.map((link) => (
                  <li key={link.network}>
                    <a className="grid h-11 w-11 place-items-center rounded-full text-app-text hover:bg-app-surface-soft" href={link.url} rel="me ugc nofollow noopener" aria-label={SOCIAL_NETWORKS[link.network].label}>
                      <SocialIcon network={link.network} />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </header>

        {document.blocks.length > 0 ? (
          <nav aria-label={PUBLIC_PAGE_COPY.linksLabel}>
            <ul className="m-0 grid list-none gap-3 p-0">
              {document.blocks.map((block) => (
                <li key={block.id}>
                  <a className="flex min-h-14 w-full items-center justify-center rounded-2xl border border-app-border bg-app-surface px-5 py-3 font-bold leading-snug break-words shadow-sm transition-colors hover:border-app-accent hover:bg-app-surface-soft" href={block.url} rel="ugc nofollow noopener">
                    {block.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {showBadge ? (
          <footer className="pt-4 text-xs text-app-muted">
            <Link className="underline" href="/" prefetch={false}>{PUBLIC_PAGE_COPY.badge(PRODUCT.codename)}</Link>
          </footer>
        ) : null}
      </article>
    </Root>
  );
}
