import type { Metadata } from "next";
import { PRODUCT } from "@/lib/product";
import { Landing } from "../landing";
export const metadata: Metadata = { title: `Piloto para profissionais | ${PRODUCT.codename}`, description: "Uma página mobile para levar visitas ao próximo passo e entender resultados.", openGraph: { title: "Sua página, seus caminhos, resultados claros", description: "Piloto do hub de conversão mobile para profissionais e negócios locais.", type: "website" } };
export default function ProfessionalsPage() { return <Landing variant="professionals" />; }
