import { ImageResponse } from "next/og";
import { PRODUCT } from "@/lib/product";
import { initialsFor } from "@/modules/profiles/content";
import { resolveRouteSlug } from "@/modules/publishing/route-slug";
import { getPublicPage } from "@/modules/publishing/server";

// Link preview image (WhatsApp, Instagram, iMessage…). Cached like the page and invalidated with it.
export const revalidate = 60;
export const alt = "Prévia da página";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const route = resolveRouteSlug((await params).slug);
  const result = route.kind === "canonical" ? await getPublicPage(route.slug) : null;
  const title = result?.state === "published" ? result.document.title : PRODUCT.codename;
  const bio = result?.state === "published" ? result.document.bio.replace(/\s+/g, " ").slice(0, 140) : "";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, padding: 80, background: "#f5f6fa", color: "#171a22", textAlign: "center" }}>
        <div style={{ width: 180, height: 180, borderRadius: 999, background: "#3156d3", color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 72, fontWeight: 700 }}>{initialsFor(title)}</div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, maxWidth: 1000 }}>{title}</div>
        {bio ? <div style={{ fontSize: 32, color: "#596171", maxWidth: 960 }}>{bio}</div> : null}
      </div>
    ),
    size,
  );
}
