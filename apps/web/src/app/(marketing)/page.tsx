import type { Metadata } from "next";
import { HOME_COPY } from "@/content/pt-BR";
import { PRODUCT } from "@/lib/product";
import { HOME_ALTERNATES } from "./alternates";
import { Home } from "./home";

export const metadata: Metadata = {
  title: `${PRODUCT.name} — ${HOME_COPY.meta.title}`,
  description: HOME_COPY.meta.description,
  alternates: { canonical: "/", languages: HOME_ALTERNATES },
  openGraph: { title: `${PRODUCT.name} — ${HOME_COPY.meta.title}`, description: HOME_COPY.meta.description, type: "website", locale: "pt_BR" },
};

export default function HomePage() { return <Home />; }
