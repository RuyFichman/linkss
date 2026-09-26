import type { Metadata } from "next";
import { PUBLIC_PAGE_COPY } from "@/content/pt-BR";
import { publicPageUrl } from "@/lib/app-url";
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
 * configuration change. Only published pages are indexable.
 */
export function buildPublicPageMetadata(result: PublicPageResult): Metadata {
  if (result.state === "suspended") return { title: { absolute: PUBLIC_PAGE_COPY.suspendedTitle }, robots: NOT_INDEXED };
  if (result.state !== "published") return { title: { absolute: PUBLIC_PAGE_COPY.notFoundTitle }, robots: NOT_INDEXED };

  const { document } = result;
  const url = publicPageUrl(result.slug);
  const title = document.title;
  const description = truncate(document.bio || PUBLIC_PAGE_COPY.defaultDescription(title), DESCRIPTION_MAX_LENGTH);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: "profile", url, title, description, siteName: PRODUCT.codename, locale: "pt_BR" },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}
