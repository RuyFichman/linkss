import { preload } from "react-dom";
import { PUBLIC_PAGE_COPY } from "@/content/public-page";
import { appUrl } from "@/lib/app-url";
import { PixelConsent } from "@/modules/pixels/components/pixel-consent";
import type { PublicPageResult } from "../public-page";
import { pageChromeColor, priorityImagePreload } from "./page-hints";
import { PublicPageView } from "./public-page-view";

type Published = Extract<PublicPageResult, { state: "published" }>;

/**
 * A page on the air as visitors get it: the rendered document, the report link and, when the page
 * has pixels in force, the consent notice (ADR 0017). The preview and the editor reuse
 * `PublicPageView` without any of it. Web Vitals and the customer-analytics collector (ADR 0011)
 * are mounted by the two public routes themselves, next to this component. It also gives the
 * document the page's background color and preloads the first image (`page-hints.ts`).
 *
 * `viaCustomDomain`: the page is answering on its owner's hostname (ADR 0016), where the product
 * itself is not served, so links to the product are absolute.
 */
export function PublishedPage({ result, viaCustomDomain = false }: { result: Published; viaCustomDomain?: boolean }) {
  const productPath = (path: string) => (viaCustomDomain ? appUrl(path) : path);
  // The first image of the page is requested from the head, with the same sources the <img> uses,
  // so the browser reuses the response. Only here: the preview and the editor never preload.
  const image = priorityImagePreload(result.document);
  if (image) preload(image.src, { as: "image", imageSrcSet: image.srcSet, imageSizes: image.sizes, fetchPriority: "high" });
  const chromeColor = pageChromeColor(result.document);
  return (
    <>
      {/* The browser paints its bars and the overscroll area with the document background: make it the page's. A validated hex color only. */}
      {chromeColor ? <style dangerouslySetInnerHTML={{ __html: `html,body{background:${chromeColor}}` }} /> : null}
      <PublicPageView document={result.document} showBadge={result.showBadge} slug={result.slug} homeHref={productPath("/")} />
      <footer className="bg-app-bg px-4 py-5 text-center text-sm"><a className="underline underline-offset-4" href={productPath("/denunciar?pagina=" + encodeURIComponent(result.slug))}>{PUBLIC_PAGE_COPY.report}</a></footer>
      {result.pixels ? <PixelConsent slug={result.slug} pixels={result.pixels} /> : null}
    </>
  );
}

export function SuspendedPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-app-bg px-4 text-center text-app-text">
      <div className="grid max-w-md gap-3">
        <h1 className="m-0 text-2xl font-bold">{PUBLIC_PAGE_COPY.suspendedTitle}</h1>
        <p className="m-0 text-app-muted">{PUBLIC_PAGE_COPY.suspended}</p>
      </div>
    </main>
  );
}
