import type { Metadata } from "next";
import { HOME_COPY } from "@/content/es-ES";
import { PRODUCT } from "@/lib/product";
import { HOME_ALTERNATES } from "../alternates";
import { Home } from "../home";

// Reserved in reserved_slugs like every top-level route (migration 202610300001).
export const metadata: Metadata = {
  title: `${PRODUCT.name} — ${HOME_COPY.meta.title}`,
  description: HOME_COPY.meta.description,
  alternates: { canonical: "/es", languages: HOME_ALTERNATES },
  openGraph: { title: `${PRODUCT.name} — ${HOME_COPY.meta.title}`, description: HOME_COPY.meta.description, type: "website", locale: "es_ES" },
};

export default function SpanishHomePage() { return <Home locale="es-ES" />; }
