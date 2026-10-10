import type { Metadata } from "next";
import Link from "next/link";
import { currentLegalDocuments } from "@/modules/legal/server";
import { BRAND_CLASS } from "@/ui/brand-font";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Termos de Uso" };

export default async function TermsPage() {
  const document = (await currentLegalDocuments()).find((item) => item.kind === "terms");
  return (
    <main className={BRAND_CLASS}>
      <article className="app-shell max-w-3xl py-8 sm:py-12">
        <h1 className="text-3xl font-bold">Termos de Uso</h1>
        {document ? (
          <>
            <p className="mt-3 text-sm text-app-muted">Versão {document.version} · hash {document.sha256.slice(0, 12)}…</p>
            <div className="mt-6 whitespace-pre-wrap leading-7">{document.body}</div>
          </>
        ) : <p className="mt-5 leading-7">O texto está em revisão jurídica e ainda não foi ativado. O acesso ao MVP permanece privado.</p>}
        <Link href="/" className="mt-8 inline-block underline">Voltar ao início</Link>
      </article>
    </main>
  );
}
