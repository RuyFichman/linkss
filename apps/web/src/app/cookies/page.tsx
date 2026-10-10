import type { Metadata } from "next";
import Link from "next/link";
import { currentLegalDocuments } from "@/modules/legal/server";
import { BRAND_CLASS } from "@/ui/brand-font";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cookies e tecnologias semelhantes" };

export default async function CookiesPage() {
  const document = (await currentLegalDocuments()).find((item) => item.kind === "cookies");
  return (
    <main className={BRAND_CLASS}>
      <article className="app-shell max-w-3xl py-8 sm:py-12">
        <h1 className="text-3xl font-bold">Cookies e tecnologias semelhantes</h1>
        {document ? (
          <>
            <p className="mt-3 text-sm text-app-muted">Versão {document.version} · hash {document.sha256.slice(0, 12)}…</p>
            <div className="mt-6 whitespace-pre-wrap leading-7">{document.body}</div>
          </>
        ) : <p className="mt-5 leading-7">O texto está em revisão jurídica e ainda não foi ativado. A contagem de visitas das páginas públicas não usa cookies nem armazenamento no navegador.</p>}
        <Link href="/" className="mt-8 inline-block underline">Voltar ao início</Link>
      </article>
    </main>
  );
}
