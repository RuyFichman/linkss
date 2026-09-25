import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Projeto LNK",
  description: "Fundação técnica do hub brasileiro de conversão mobile.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
