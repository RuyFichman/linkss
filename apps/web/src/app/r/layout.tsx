import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SHARED_REPORT_COPY } from "@/content/shared-report";

/**
 * Shared reports (ADR 0013). The title is generic on purpose: the address holds a secret, so the
 * tab name, a link preview or a bookmark must not say whose report it is. No Open Graph image
 * (its URL would have to carry the token), no indexing, and no referrer sent anywhere; the same
 * rules are also response headers (next.config.ts), which do not depend on the HTML being parsed.
 */
export const metadata: Metadata = {
  title: { absolute: SHARED_REPORT_COPY.metaTitle },
  description: null,
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
  referrer: "no-referrer",
};

export default function SharedReportLayout({ children }: { children: ReactNode }) {
  return children;
}
