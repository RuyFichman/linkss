import type { Metadata } from "next";
import { PRODUCT } from "@/lib/product";
import { Landing } from "./landing";
export const metadata: Metadata = { title: `${PRODUCT.codename} — hub de conversão mobile`, description: "Página profissional, WhatsApp, Pix, agenda e resultados em linguagem simples. Entre na lista do piloto.", openGraph: { title: `${PRODUCT.codename} — piloto em construção`, description: "Transforme visitas da bio em próximos passos claros.", type: "website" } };
export default function HomePage() { return <Landing variant="neutral" />; }
