"use client";

import { useEffect, useRef, useState } from "react";
import { PUBLIC_PAGE_COPY } from "@/content/public-page";
import { EMBED_FRAME_ATTRIBUTES, EMBED_PROVIDERS, embedFrameSrc, embedLayout, embedPageUrl, type EmbedProvider } from "@/modules/blocks/embed";

const USER_LINK_REL = "ugc nofollow noopener noreferrer";
const BOX_CLASS = "page-surface block w-full overflow-hidden rounded-[var(--page-radius)] border border-[var(--surface-border)] bg-[var(--surface-bg)] text-[var(--surface-text)]";
const FACADE_CLASS = "flex h-full w-full flex-col items-center justify-center gap-2 px-4 py-3 text-center";

function PlayIcon() {
  return (
    <svg width={44} height={44} viewBox="0 0 24 24" aria-hidden focusable={false}>
      <circle cx={12} cy={12} r={11} fill="currentColor" opacity={0.14} />
      <path d="M10 8l6 4-6 4z" fill="currentColor" />
    </svg>
  );
}

/**
 * Click-to-load embed (ADR 0010). Until the visitor asks, nothing is requested from the provider:
 * the box is a link to the provider's own page (which is what works without JavaScript). The first
 * plain click swaps it for the iframe, whose address is built from the validated provider and id.
 * The box has the player's final size, so loading it never shifts the layout.
 */
export function EmbedFacade({ blockId, provider, embedRef, title, interactive }: { blockId: string; provider: EmbedProvider; embedRef: string; title: string; interactive: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const layout = embedLayout(provider, embedRef);
  const pageUrl = embedPageUrl(provider, embedRef);
  const src = embedFrameSrc(provider, embedRef, { autoplay: true });
  const providerLabel = EMBED_PROVIDERS[provider].label;

  useEffect(() => {
    if (loaded) frame.current?.focus();
  }, [loaded]);

  if (!pageUrl || !src) return null;
  const sizeClass = layout.kind === "video" ? "aspect-video" : layout.height === 152 ? "h-[152px]" : "h-[352px]";
  const data = { "data-block-id": blockId, "data-block-type": "embed" };

  if (loaded) {
    return (
      <div {...data} className={`${BOX_CLASS} ${sizeClass}`}>
        <iframe
          ref={frame}
          className="h-full w-full border-0"
          src={src}
          title={PUBLIC_PAGE_COPY.embed.frameTitle(title, providerLabel)}
          sandbox={EMBED_FRAME_ATTRIBUTES.sandbox}
          allow={EMBED_FRAME_ATTRIBUTES.allow}
          referrerPolicy={EMBED_FRAME_ATTRIBUTES.referrerPolicy}
          loading={EMBED_FRAME_ATTRIBUTES.loading}
          allowFullScreen
        />
      </div>
    );
  }

  const content = (
    <>
      <PlayIcon />
      <span className="font-bold leading-snug break-words">{title}</span>
      <span className="text-sm text-[var(--surface-muted)]">{PUBLIC_PAGE_COPY.embed.load(providerLabel)}</span>
      <span className="text-xs text-[var(--surface-muted)]">{PUBLIC_PAGE_COPY.embed.privacy(providerLabel)}</span>
    </>
  );

  if (!interactive) return <div {...data} className={`${BOX_CLASS} ${sizeClass}`}><div className={FACADE_CLASS}>{content}</div></div>;

  return (
    <a
      {...data}
      className={`${BOX_CLASS} ${sizeClass} hover:border-[var(--btn-hover-border)]`}
      href={pageUrl}
      rel={USER_LINK_REL}
      onClick={(event) => {
        // Modified clicks (new tab, download) keep the browser's own behavior.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        setLoaded(true);
      }}
    >
      <span className={FACADE_CLASS}>{content}</span>
    </a>
  );
}
