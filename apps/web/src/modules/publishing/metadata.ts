import type { Metadata } from "next";
import { PUBLIC_PAGE_COPY } from "@/content/pt-BR";
import { appUrl, publicPageUrl } from "@/lib/app-url";
import { customDomainUrl } from "@/modules/domains/hostname";
import { PRODUCT } from "@/lib/product";
import type { PublicPageResult } from "./public-page";

const DESCRIPTION_MAX_LENGTH = 160;

function truncate(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

const NOT_INDEXED: Metadata["robots"] = { index: false, follow: false };

/**
 * Title, description, canonical and Open Graph for a public page. The canonical URL comes from
 * NEXT_PUBLIC_APP_URL (never the request Host), so switching to the purchased domain is a
 * configuration change. A page with a custom domain in force is canonical there, at both of its
 * addresses, so search engines see one page. Only published pages are indexable.
 *
 * `viaCustomDomain` is set by the route that answers the custom hostname: it has no Open Graph
 * image file of its own, so the image of the product address is named explicitly.
 */
export function buildPublicPageMetadata(result: PublicPageResult, options: { viaCustomDomain?: boolean } = {}): Metadata {
  if (result.state === "suspended") return { title: { absolute: PUBLIC_PAGE_COPY.suspendedTitle }, robots: NOT_INDEXED };
  if (result.state !== "published") return { title: { absolute: PUBLIC_PAGE_COPY.notFoundTitle }, robots: NOT_INDEXED };

  const { document } = result;
  const url = result.customDomain ? customDomainUrl(result.customDomain) : publicPageUrl(result.slug);
  const title = document.title;
  const description = truncate(document.bio || PUBLIC_PAGE_COPY.defaultDescription(title), DESCRIPTION_MAX_LENGTH);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: "profile", url, title, description, siteName: PRODUCT.name, locale: "pt_BR", ...(options.viaCustomDomain ? { images: [{ url: appUrl(`/${result.slug}/opengraph-image`), width: 1200, height: 630 }] } : {}) },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}
