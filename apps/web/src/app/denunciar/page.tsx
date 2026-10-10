import type { Metadata } from "next";
import Link from "next/link";
import { submitPublicReportAction } from "@/modules/moderation/actions";
import { BRAND_CLASS } from "@/ui/brand-font";

export const metadata: Metadata = { title: "Denunciar página", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const REASONS = [
  ["phishing", "Golpe ou coleta enganosa de dados"],
  ["impersonation", "Imitação de pessoa ou organização"],
  ["illegal", "Conteúdo possivelmente ilegal"],
  ["spam", "Spam ou divulgação abusiva"],
  ["privacy", "Exposição indevida de dados pessoais"],
  ["other", "Outro motivo"],
] as const;

export default async function ReportPage({ searchParams }: {
  searchParams: Promise<{ pagina?: string; estado?: string }>;
}) {
  const { pagina, estado } = await searchParams;
  const initialSlug = typeof pagina === "string" && /^[a-z0-9][a-z0-9-]{2,29}$/.test(pagina) ? pagina : "";
  return (
    <main className={BRAND_CLASS}>
      <div className="app-shell max-w-2xl py-8 sm:py-12">
        <article className="surface-card p-5 sm:p-8">
          <h1 className="text-3xl font-bold">Denunciar uma página</h1>
          <p className="mt-3 text-app-muted">Use este formulário para sinalizar golpes, falsidade, conteúdo ilegal, spam ou exposição indevida de dados. A denúncia entra na fila de análise. Não inclua senhas, documentos ou dados sensíveis nos detalhes.</p>
          {estado === "recebido" ? (
            <div role="status" className="mt-5 rounded-xl border border-app-border p-4">
              Recebemos a informação. Por segurança, a confirmação é igual mesmo se o endereço já não estiver disponível ou se a denúncia for repetida.
            </div>
          ) : null}
          {estado === "indisponivel" ? <p role="alert" className="mt-5 text-red-700">O canal está temporariamente indisponível. Tente novamente mais tarde.</p> : null}
          {estado === "erro" ? <p role="alert" className="mt-5 text-red-700">Confira o endereço, o motivo e o tamanho dos detalhes.</p> : null}
          <form action={submitPublicReportAction} className="mt-6 grid gap-5">
            <div className="grid gap-1">
              <label htmlFor="report-page" className="font-semibold">Endereço da página</label>
              <input id="report-page" name="pagina" defaultValue={initialSlug} required minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9-]{2,29}" autoComplete="off" className="ui-input" />
              <p className="text-sm text-app-muted">Digite apenas a parte após a barra no endereço da página.</p>
            </div>
            <div className="grid gap-1">
              <label htmlFor="report-reason" className="font-semibold">Motivo</label>
              <select id="report-reason" name="motivo" required defaultValue="" className="ui-input">
                <option value="" disabled>Selecione um motivo</option>
                {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="grid gap-1">
              <label htmlFor="report-detail" className="font-semibold">Detalhes (opcional)</label>
              <textarea id="report-detail" name="detalhes" maxLength={500} rows={5} className="ui-input" />
              <p className="text-sm text-app-muted">Até 500 caracteres. Não coloque dados pessoais de terceiros sem necessidade.</p>
            </div>
            <div className="sr-only" aria-hidden="true"><label htmlFor="report-website">Site</label><input id="report-website" name="website" tabIndex={-1} autoComplete="off" /></div>
            <button type="submit" className="ui-button ui-button-primary justify-self-start">Enviar denúncia</button>
          </form>
          <Link href="/" className="mt-6 inline-block underline">Voltar ao início</Link>
        </article>
      </div>
    </main>
  );
}
