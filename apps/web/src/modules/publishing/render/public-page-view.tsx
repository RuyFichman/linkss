import Link from "next/link";
import { PUBLIC_PAGE_COPY } from "@/content/pt-BR";
import { PRODUCT } from "@/lib/product";
import { SOCIAL_NETWORKS, whatsAppHref } from "@/modules/blocks";
import { initialsFor } from "@/modules/profiles/content";
import type { PublishedBlock, PublishedDocument } from "../document";
import { SocialIcon, WhatsAppIcon } from "./social-icon";

// Links are user content: no ranking credit, no window.opener, no referrer (ADR 0007/0008).
const USER_LINK_REL = "ugc nofollow noopener noreferrer";
const ICON_CLASS = "grid h-11 w-11 place-items-center rounded-full text-app-text hover:bg-app-surface-soft";
const BUTTON_CLASS = "flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-app-border bg-app-surface px-5 py-3 font-bold leading-snug break-words shadow-sm transition-colors hover:border-app-accent hover:bg-app-surface-soft";

/**
 * One block. `interactive={false}` (editor preview) renders the same look with spans instead of
 * anchors, so the preview neither navigates nor could trigger analytics. `data-block-*` are the
 * stable hooks for Sprint 6 click analytics.
 */
function BlockView({ block, interactive }: { block: PublishedBlock; interactive: boolean }) {
  const data = { "data-block-id": block.id, "data-block-type": block.type };
  switch (block.type) {
    case "link":
      return interactive
        ? <a {...data} className={BUTTON_CLASS} href={block.url} rel={USER_LINK_REL}>{block.title}</a>
        : <span {...data} className={BUTTON_CLASS}>{block.title}</span>;
    case "text":
      return <p {...data} className="m-0 whitespace-pre-line break-words leading-relaxed">{block.text}</p>;
    case "social":
      return (
        <nav {...data} aria-label={PUBLIC_PAGE_COPY.socialLabel}>
          <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
            {block.items.map((link) => (
              <li key={link.network}>
                {interactive ? (
                  <a className={ICON_CLASS} href={link.url} rel={`me ${USER_LINK_REL}`} aria-label={SOCIAL_NETWORKS[link.network].label}>
                    <SocialIcon network={link.network} />
                  </a>
                ) : (
                  <span className={ICON_CLASS} role="img" aria-label={SOCIAL_NETWORKS[link.network].label}>
                    <SocialIcon network={link.network} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
      );
    case "whatsapp": {
      const content = <><WhatsAppIcon /><span>{block.label}</span><span className="sr-only">{PUBLIC_PAGE_COPY.whatsappSuffix}</span></>;
      return interactive
        ? <a {...data} className={BUTTON_CLASS} href={whatsAppHref(block.phone, block.message)} rel={USER_LINK_REL}>{content}</a>
        : <span {...data} className={BUTTON_CLASS}>{content}</span>;
    }
    case "divider":
      return <hr {...data} className="my-2 w-full border-0 border-t border-app-border" />;
  }
}

/**
 * Public page markup for a published (or preview) document. Pure server-rendered HTML with plain
 * anchors: every link works without JavaScript, so a failing analytics/telemetry script cannot
 * break navigation.
 */
export function PublicPageView({ document, showBadge, as: Root = "main", interactive = true }: { document: PublishedDocument; showBadge: boolean; as?: "main" | "div"; interactive?: boolean }) {
  return (
    <Root className="min-h-screen bg-app-bg px-4 py-10 text-app-text sm:py-14">
      <article className="mx-auto grid w-full max-w-md gap-6 text-center">
        <header className="grid justify-items-center gap-3">
          {/* Sprint 5 replaces the initials with the uploaded avatar (sized, no layout shift). */}
          <span aria-hidden="true" className="grid h-24 w-24 place-items-center rounded-full bg-app-accent text-3xl font-bold text-white">{initialsFor(document.title)}</span>
          <h1 className="m-0 text-2xl font-bold leading-tight break-words sm:text-3xl">{document.title}</h1>
          {document.bio ? <p className="m-0 max-w-prose whitespace-pre-line break-words leading-relaxed text-app-muted">{document.bio}</p> : null}
        </header>

        {document.blocks.length > 0 ? (
          <div className="grid gap-3">
            {document.blocks.map((block) => <BlockView key={block.id} block={block} interactive={interactive} />)}
          </div>
        ) : null}

        {showBadge ? (
          <footer className="pt-4 text-xs text-app-muted">
            {interactive ? <Link className="underline" href="/" prefetch={false}>{PUBLIC_PAGE_COPY.badge(PRODUCT.codename)}</Link> : <span className="underline">{PUBLIC_PAGE_COPY.badge(PRODUCT.codename)}</span>}
          </footer>
        ) : null}
      </article>
    </Root>
  );
}
