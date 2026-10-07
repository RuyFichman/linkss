import type { Metadata } from "next";
import { HOME_COPY } from "@/content/pt-BR";
import { PRODUCT } from "@/lib/product";
import { Home } from "./home";

export const metadata: Metadata = {
  title: `${PRODUCT.codename} — ${HOME_COPY.meta.title}`,
  description: HOME_COPY.meta.description,
  openGraph: { title: `${PRODUCT.codename} — ${HOME_COPY.meta.title}`, description: HOME_COPY.meta.description, type: "website" },
};

export default function HomePage() { return <Home />; }
