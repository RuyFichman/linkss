import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { PublicPageAnalytics } from "@/modules/analytics/components/public-page-analytics";
import { PublicPageWebVitals } from "@/modules/publishing/components/web-vitals-reporter";
import { buildPublicPageMetadata } from "@/modules/publishing/metadata";
import { PublishedPage, SuspendedPage } from "@/modules/publishing/render/published-page";
import { resolveRouteSlug } from "@/modules/publishing/route-slug";
import { getPublicPage } from "@/modules/publishing/server";

// Public renderer (ADR 0007). Pages are rendered on first request and cached (ISR). Publishing,
// restoring, unpublishing, changing the address and deleting call revalidatePath for immediate
// updates; this window is only the fallback (e.g. a suspension applied directly in the database).
export const revalidate = 60;
export const dynamicParams = true;

export function generateStaticParams(): Array<{ slug: string }> {
  // Nothing is prerendered at build time; every address is generated on demand and then cached.
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const route = resolveRouteSlug((await params).slug);
  if (route.kind !== "canonical") return buildPublicPageMetadata({ state: "not_found" });
  return buildPublicPageMetadata(await getPublicPage(route.slug));
}

export default async function PublicPage({ params }: Props) {
  const route = resolveRouteSlug((await params).slug);
  if (route.kind === "invalid") notFound();
  if (route.kind === "redirect") permanentRedirect(`/${route.slug}`);

  const result = await getPublicPage(route.slug);
  switch (result.state) {
    case "published":
      return (
        <>
          <PublishedPage result={result} />
          <PublicPageWebVitals />
          {/* Customer analytics (ADR 0011): only the public routes mount the collector, never the preview. */}
          <PublicPageAnalytics slug={result.slug} />
        </>
      );
    case "moved":
      // Temporary on purpose: the owner may take the old address back during its hold.
      redirect(`/${result.slug}`);
    case "suspended":
      return <SuspendedPage />;
    case "unpublished":
    case "not_found":
      // Same answer for "never existed" and "not published": a real 404 that does not reveal drafts.
      notFound();
  }
}
