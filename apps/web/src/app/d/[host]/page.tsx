import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { PublicPageAnalytics } from "@/modules/analytics/components/public-page-analytics";
import { isStoredHostname } from "@/modules/domains/hostname";
import { PublicPageWebVitals } from "@/modules/publishing/components/web-vitals-reporter";
import { buildPublicPageMetadata } from "@/modules/publishing/metadata";
import { publicPageViewport } from "@/modules/publishing/render/page-hints";
import { PublishedPage, SuspendedPage } from "@/modules/publishing/render/published-page";
import { getPublicPageByDomain } from "@/modules/publishing/server";

// A page answering on its owner's hostname (ADR 0016). Nobody types this address: next.config.ts
// rewrites "/" on every hostname that is not the product's own to /d/<hostname>. Cached like
// /[slug] (ISR); whether the hostname opens a page is decided by the database on each
// regeneration (proof of control and plan), so the 60-second window is also how long a removed
// domain or a lost plan can keep answering.
export const revalidate = 60;
export const dynamicParams = true;

export function generateStaticParams(): Array<{ host: string }> {
  return [];
}

type Props = { params: Promise<{ host: string }> };

/** The Host header as the rewrite passed it. Anything that is not a stored hostname never reaches the database. */
function hostnameFrom(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return isStoredHostname(decoded) ? decoded : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const hostname = hostnameFrom((await params).host);
  if (!hostname) return buildPublicPageMetadata({ state: "not_found" });
  return buildPublicPageMetadata(await getPublicPageByDomain(hostname), { viaCustomDomain: true });
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const hostname = hostnameFrom((await params).host);
  if (!hostname) return {};
  return publicPageViewport(await getPublicPageByDomain(hostname));
}

export default async function CustomDomainPage({ params }: Props) {
  const hostname = hostnameFrom((await params).host);
  if (!hostname) notFound();

  const result = await getPublicPageByDomain(hostname);
  switch (result.state) {
    case "published":
      return (
        <>
          <PublishedPage result={result} viaCustomDomain />
          <PublicPageWebVitals />
          {/* Same collector as /[slug] (ADR 0011): a visit counts for the page whatever address opened it. */}
          <PublicPageAnalytics slug={result.slug} />
        </>
      );
    case "suspended":
      return <SuspendedPage />;
    default:
      // One answer for a hostname that is unknown, unproven, out of plan or whose page is off the air.
      notFound();
  }
}
