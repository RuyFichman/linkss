import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/app-url";

// Public pages are indexable; the product area, API and prototype are not. No sitemap on purpose:
// listing every published address would make scraping trivial.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/api", "/proto", "/auth"] },
    host: appUrl(),
  };
}
