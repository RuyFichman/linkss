import type { Metadata } from "next";
import { PRODUCT } from "@/lib/product";
import { Landing } from "../landing";
export const metadata: Metadata = { title: `Piloto para agências | ${PRODUCT.codename}`, description: "Gerencie páginas de clientes e compartilhe resultados claros.", openGraph: { title: "Todas as páginas dos clientes em uma conta", description: "Piloto do hub de conversão mobile para operação multi-perfil.", type: "website" } };
export default function AgenciesPage() { return <Landing variant="agencies" />; }
