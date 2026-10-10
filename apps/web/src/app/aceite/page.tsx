import { redirect } from "next/navigation";
import { PRODUCT } from "@/lib/product";
import { getCurrentUserId } from "@/modules/identity/session";
import { acceptLegalAction } from "@/modules/legal/actions";
import { currentLegalDocuments } from "@/modules/legal/server";
import { BRAND_CLASS } from "@/ui/brand-font";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aceite dos documentos", robots: { index: false, follow: false } };

export default async function LegalAcceptancePage({ searchParams }: {
  searchParams: Promise<{ erro?: string }>;
}) {
  if (!(await getCurrentUserId())) redirect("/entrar?next=/aceite");
  const documents = await currentLegalDocuments();
  const terms = documents.find((document) => document.kind === "terms");
  const privacy = documents.find((document) => document.kind === "privacy");
  if (!terms || !privacy) return <main className={BRAND_CLASS}><div className="app-shell max-w-3xl py-10"><h1 className="text-3xl font-bold">Documentos temporariamente indisponíveis</h1><p className="mt-3">O aceite será liberado quando os dois textos revisados estiverem ativos.</p></div></main>;
  if (terms.accepted && privacy.accepted) redirect("/app");
  const { erro } = await searchParams;

  return (
    <main className={BRAND_CLASS}>
      <div className="app-shell max-w-3xl py-8 sm:py-12">
        <article className="surface-card p-5 sm:p-8">
          <h1 className="text-3xl font-bold">Revise os documentos do {PRODUCT.codename}</h1>
          <p className="mt-3 text-app-muted">Estas versões estão ativas para a sua conta. Leia os textos antes de continuar.</p>
          {erro ? <p role="alert" className="mt-4 text-red-700">O texto mudou ou o aceite não pôde ser registrado. Releia as versões abaixo e tente novamente.</p> : null}
          {[terms, privacy].map((document) => (
            <section key={document.id} className="mt-7">
              <h2 className="text-xl font-bold">{document.kind === "terms" ? "Termos de Uso" : "Aviso de Privacidade"} — {document.version}</h2>
              <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-app-border bg-app-bg p-4 text-sm leading-6" tabIndex={0}>{document.body}</div>
            </section>
          ))}
          <form action={acceptLegalAction} className="mt-7 grid gap-4">
            <input type="hidden" name="terms" value={terms.id} />
            <input type="hidden" name="privacy" value={privacy.id} />
            <label className="flex items-start gap-3">
              <input type="checkbox" name="agree" value="yes" required className="mt-1" />
              <span>Li as versões dos Termos de Uso e do Aviso de Privacidade exibidas acima e aceito continuar com elas.</span>
            </label>
            <button type="submit" className="ui-button ui-button-primary justify-self-start">Registrar aceite e continuar</button>
          </form>
        </article>
      </div>
    </main>
  );
}
