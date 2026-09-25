import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PRODUCT } from "@/lib/product";
import { DebugPanel } from "@/prototype/debug-panel";
import { ProtoProvider } from "@/prototype/store";
export const metadata: Metadata = { title: `Protótipo | ${PRODUCT.codename}`, robots: { index: false, follow: false } };
export default function PrototypeLayout({ children }: { children: ReactNode }) { return <ProtoProvider><div className="min-h-screen"><span className="fixed bottom-20 right-3 z-50 rounded-full bg-app-text px-3 py-1 text-xs font-bold text-white shadow-raised">Protótipo</span>{children}<DebugPanel /></div></ProtoProvider>; }
