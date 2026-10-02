import Link from "next/link";
import type { CSSProperties } from "react";
import { preconnect } from "react-dom";
import { PIX_KEY_TYPE_LABELS, PUBLIC_PAGE_COPY } from "@/content/public-page";
import { PRODUCT } from "@/lib/product";
import { formatPixKey, SOCIAL_NETWORKS, whatsAppHref } from "@/modules/blocks";
import { submitLeadAction } from "@/modules/leads/actions";
import { avatarSources, imageSources, mediaOrigin } from "@/modules/media/url";
import { initialsFor } from "@/modules/profiles/content";
import { THEME_FONT_FAMILY } from "@/modules/themes/fonts";
import { resolveTheme, type ResolvedTheme } from "@/modules/themes/resolve";
import type { PublishedBlock, PublishedDocument } from "../document";
import { EmbedFacade } from "./embed-facade";
import { LeadForm, LeadFormPreview } from "./lead-form";
import { PixCopyButton } from "./pix-copy-button";
import { SocialIcon, WhatsAppIcon } from "./social-icon";

// Links are user content: no ranking credit, no window.opener, no referrer (ADR 0007/0008).
const USER_LINK_REL = "ugc nofollow noopener noreferrer";
const ICON_CLASS = "grid h-11 w-11 place-items-center rounded-full text-[var(--page-text)] hover:bg-[var(--icon-hover-bg)]";
// Colors, corners and spacing come from CSS custom properties set once on the page root (ADR 0010).
const BUTTON_BASE = "page-button flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--page-radius)] border border-[var(--btn-border)] bg-[var(--btn-bg)] px-5 py-3 font-bold leading-snug break-words text-[var(--btn-text)] shadow-sm transition-colors";
const BUTTON_CLASS = `${BUTTON_BASE} hover:border-[var(--btn-hover-border)] hover:bg-[var(--btn-hover-bg)]`;
const SURFACE_CLASS = "grid gap-3 rounded-[var(--page-radius)] border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4 text-[var(--surface-text)]";

/**
 * Theme as CSS custom properties. Every value comes from `resolveTheme` (hex colors and catalog
 * sizes derived from validated tokens); nothing stored is ever written into a style as it is.
 */
function themeStyle(theme: ResolvedTheme): CSSProperties {
  return {
    "--page-bg": theme.pageBackground,
    "--page-text": theme.pageText,
    "--page-muted": theme.pageMuted,
    "--btn-bg": theme.buttonBackground,
    "--btn-text": theme.buttonText,
    "--btn-border": theme.buttonBorder,
    "--btn-hover-bg": theme.buttonHoverBackground,
    "--btn-hover-border": theme.buttonHoverBorder,
    "--icon-hover-bg": theme.iconHoverBackground,
    "--surface-bg": theme.surfaceBackground,
    "--surface-text": theme.surfaceText,
    "--surface-muted": theme.surfaceMuted,
    "--surface-border": theme.surfaceBorder,
    "--accent-bg": theme.accentBackground,
    "--accent-text": theme.accentText,
    "--page-divider": theme.divider,
    "--page-radius": `${theme.radiusPx}px`,
    "--page-gap": `${theme.gapPx}px`,
    fontFamily: THEME_FONT_FAMILY[theme.font],
  } as CSSProperties;
}

interface BlockContext {
  interactive: boolean;
  /** Address of the published page; without it (preview) forms cannot submit. */
  slug: string | null;
  /** The image most likely to be the largest element above the fold, if any. */
  priorityImageId: string | null;
}

/**
 * One block. `interactive={false}` (editor preview) renders the same look with spans instead of
 * anchors, so the preview neither navigates nor could trigger analytics. `data-block-*` are the
 * stable hooks for Sprint 6 click analytics.
 */
function BlockView({ block, context }: { block: PublishedBlock; context: BlockContext }) {
  const { interactive } = context;
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
      return <hr {...data} className="my-2 w-full border-0 border-t border-[var(--page-divider)]" />;
    case "image": {
      // Explicit dimensions reserve the space (no layout shift); the browser picks the variant.
      const priority = block.id === context.priorityImageId;
      return (
        <picture {...data} className="block">
          <img
            {...imageSources(block.mediaId, block.width)}
            className="h-auto w-full rounded-[var(--page-radius)] bg-[var(--surface-bg)]"
            width={block.width}
            height={block.height}
            alt={block.alt}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
          />
        </picture>
      );
    }
    case "embed":
      return <EmbedFacade blockId={block.id} provider={block.provider} embedRef={block.ref} title={block.title} interactive={interactive} />;
    case "pix": {
      const keyType = PIX_KEY_TYPE_LABELS[block.keyType];
      return (
        <section {...data} className={`${SURFACE_CLASS} justify-items-center`} aria-label={block.label}>
          <strong className="text-lg leading-snug break-words">{block.label}</strong>
          <p className="m-0 grid gap-1">
            <span className="text-sm text-[var(--surface-muted)]">{PUBLIC_PAGE_COPY.pix.keyLabel(keyType)}</span>
            {/* Plain selectable text: usable even when the copy button cannot run. */}
            <span className="font-mono text-base font-bold break-all select-all">{formatPixKey(block.keyType, block.key)}</span>
          </p>
          <PixCopyButton value={block.key} className={BUTTON_CLASS} disabled={!interactive} />
          {block.paymentUrl ? (
            interactive
              ? <a className="font-bold underline" href={block.paymentUrl} rel={USER_LINK_REL}>{PUBLIC_PAGE_COPY.pix.pay}</a>
              : <span className="font-bold underline">{PUBLIC_PAGE_COPY.pix.pay}</span>
          ) : null}
          <p className="m-0 text-sm text-[var(--surface-muted)]">{PUBLIC_PAGE_COPY.pix.notice}</p>
        </section>
      );
    }
    case "form": {
      const props = { blockId: block.id, title: block.title, fields: block.fields, buttonLabel: block.buttonLabel, consentText: block.consentText, consentRequired: block.consentRequired, buttonClassName: BUTTON_CLASS };
      return interactive && context.slug
        ? <LeadForm {...props} action={submitLeadAction.bind(null, context.slug, block.id)} />
        : <LeadFormPreview {...props} buttonClassName={BUTTON_BASE} />;
    }
  }
}

/**
 * How many leading blocks can share the first screen of a phone with the header. Measured on
 * staging (2026-10-02): with a form first, the image in the second block was the LCP element and
 * still lazy, so the browser only fetched it after layout.
 */
export const PRIORITY_IMAGE_WINDOW = 3;

/**
 * The image most likely to be the LCP element: the first image among the leading blocks. Only one
 * image gets eager loading and high fetch priority; images further down stay lazy, so a page with
 * many images still costs one image above the fold.
 */
export function priorityImageId(blocks: readonly PublishedBlock[]): string | null {
  return blocks.slice(0, PRIORITY_IMAGE_WINDOW).find((block) => block.type === "image")?.id ?? null;
}

/**
 * Public page markup for a published (or preview) document. Server-rendered HTML with plain
 * anchors and a plain form: every link and the form work without JavaScript, so a failing
 * analytics/telemetry script cannot break navigation. `slug` is the published address (forms
 * post to it); the preview passes none.
 */
export function PublicPageView({ document, showBadge, as: Root = "main", interactive = true, slug = null }: { document: PublishedDocument; showBadge: boolean; as?: "main" | "div"; interactive?: boolean; slug?: string | null }) {
  const theme = resolveTheme(document.theme);
  const context: BlockContext = { interactive, slug, priorityImageId: priorityImageId(document.blocks) };

  // One early connection to the media host when the page shows images. Nothing else is hinted.
  const origin = document.avatarPath || document.blocks.some((block) => block.type === "image") ? mediaOrigin() : null;
  if (origin) preconnect(origin);

  return (
    <Root className="min-h-screen bg-[var(--page-bg)] px-4 py-10 text-[var(--page-text)] sm:py-14" style={themeStyle(theme)}>
      <article className="mx-auto grid w-full max-w-md gap-6 text-center">
        <header className="grid justify-items-center gap-3">
          {document.avatarPath ? (
            <picture className="block h-24 w-24">
              <img {...avatarSources(document.avatarPath)} className="h-24 w-24 rounded-full bg-[var(--surface-bg)] object-cover" width={96} height={96} alt={PUBLIC_PAGE_COPY.avatarAlt(document.title)} decoding="async" />
            </picture>
          ) : (
            <span aria-hidden="true" className="grid h-24 w-24 place-items-center rounded-full bg-[var(--accent-bg)] text-3xl font-bold text-[var(--accent-text)]">{initialsFor(document.title)}</span>
          )}
          <h1 className="m-0 text-2xl font-bold leading-tight break-words sm:text-3xl">{document.title}</h1>
          {document.bio ? <p className="m-0 max-w-prose whitespace-pre-line break-words leading-relaxed text-[var(--page-muted)]">{document.bio}</p> : null}
        </header>

        {document.blocks.length > 0 ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-[var(--page-gap)]">
            {document.blocks.map((block) => <BlockView key={block.id} block={block} context={context} />)}
          </div>
        ) : null}

        {showBadge ? (
          <footer className="pt-4 text-xs text-[var(--page-muted)]">
            {interactive ? <Link className="underline" href="/" prefetch={false}>{PUBLIC_PAGE_COPY.badge(PRODUCT.codename)}</Link> : <span className="underline">{PUBLIC_PAGE_COPY.badge(PRODUCT.codename)}</span>}
          </footer>
        ) : null}
      </article>
    </Root>
  );
}
