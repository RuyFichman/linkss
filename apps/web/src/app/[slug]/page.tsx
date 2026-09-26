import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { PUBLIC_PAGE_COPY } from "@/content/pt-BR";
import { PublicPageWebVitals } from "@/modules/publishing/components/web-vitals-reporter";
import { buildPublicPageMetadata } from "@/modules/publishing/metadata";
import { PublicPageView } from "@/modules/publishing/render/public-page-view";
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
          <PublicPageView document={result.document} showBadge={result.showBadge} />
          <PublicPageWebVitals />
        </>
      );
    case "moved":
      // Temporary on purpose: the owner may take the old address back during its hold.
      redirect(`/${result.slug}`);
    case "suspended":
      return (
        <main className="grid min-h-screen place-items-center bg-app-bg px-4 text-center text-app-text">
          <div className="grid max-w-md gap-3">
            <h1 className="m-0 text-2xl font-bold">{PUBLIC_PAGE_COPY.suspendedTitle}</h1>
            <p className="m-0 text-app-muted">{PUBLIC_PAGE_COPY.suspended}</p>
          </div>
        </main>
      );
    case "unpublished":
    case "not_found":
      // Same answer for "never existed" and "not published": a real 404 that does not reveal drafts.
      notFound();
  }
}
