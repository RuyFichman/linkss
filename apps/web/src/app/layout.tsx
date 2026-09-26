import type { Metadata } from "next";
import { appUrl } from "@/lib/app-url";
import { PRODUCT } from "@/lib/product";
import "./globals.css";

export const metadata: Metadata = {
  // Absolute Open Graph/canonical URLs come from configuration, never from the request Host.
  metadataBase: new URL(appUrl()),
  title: `${PRODUCT.codename} — hub de conversão mobile`,
  description: "Páginas profissionais, resultados compreensíveis e operação multi-perfil.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
