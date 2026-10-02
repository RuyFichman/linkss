"use client";

import { useEffect } from "react";
import { browserRandomId, startCollector } from "../collector";

/**
 * Starts the customer-analytics collector for a published page (ADR 0011). Mounted only by the
 * public route `app/[slug]/page.tsx`: the preview and the editor reuse the renderer without this
 * component, so they never emit events. Renders nothing and runs after hydration, so it cannot
 * affect LCP or layout.
 */
export function PublicPageAnalytics({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      return startCollector(slug, {
        document,
        window,
        navigator,
        fetch: typeof window.fetch === "function" ? (url, init) => window.fetch(url, init) : undefined,
        randomId: () => browserRandomId(window.crypto),
      });
    } catch {
      // Analytics must never break the page.
      return undefined;
    }
  }, [slug]);
  return null;
}
