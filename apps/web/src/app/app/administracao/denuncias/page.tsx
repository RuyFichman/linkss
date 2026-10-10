import { formatDateTime } from "@/lib/format-date";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";
import { reviewReportAction, setPageModerationAction } from "@/modules/moderation/actions";

export const metadata: Metadata = { title: "Fila de denúncias" };
export const dynamic = "force-dynamic";

interface Report {
  id: string;
  profileId: string;
  workspaceId: string;
  slug: string;
  reason: string;
  detail: string | null;
  status: string;
  moderationStatus: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewReason: string | null;
}

const REASON: Record<string, string> = {
  phishing: "Golpe ou coleta enganosa",
  impersonation: "Imitação",
  illegal: "Possível ilegalidade",
  spam: "Spam",
  privacy: "Dados pessoais expostos",
  other: "Outro",
};

export default async function ModerationQueue({ searchParams }: {
  searchParams: Promise<{ erro?: string }>;
}) {
  if (!(await getCurrentUserId())) redirect("/entrar");
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("list_moderation_reports");
  if (error?.code === "42501") notFound();
  const reports = Array.isArray(data) ? data as unknown as Report[] : [];
  const { erro } = await searchParams;
  return (
    <section className="app-shell max-w-5xl">
      <h1 className="text-3xl font-bold">Fila de denúncias</h1>
      <p className="mt-2 text-app-muted">Últimas 100 denúncias. Confirme os fatos antes de suspender ou reativar uma página; cada decisão e justificativa entram na auditoria.</p>
      {error ? <p role="alert" className="mt-4 text-red-700">A fila não está disponível neste ambiente.</p> : null}
      {erro ? <p role="alert" className="mt-4 text-red-700">Não foi possível concluir a ação. Confira a justificativa e tente novamente.</p> : null}
      {!error && reports.length === 0 ? <p className="mt-6 rounded-xl border border-app-border p-5">Nenhuma denúncia na fila.</p> : null}
      <div className="mt-6 grid gap-5">
        {reports.map((report) => (
          <article key={report.id} className="surface-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">{report.slug}</h2>
              <span className="ui-badge">{report.status} · página {report.moderationStatus ?? "excluída"}</span>
            </div>
            <p className="mt-2 text-sm text-app-muted">{REASON[report.reason] ?? report.reason} · {formatDateTime(report.createdAt)}</p>
            {report.detail ? <p className="mt-3 whitespace-pre-wrap">{report.detail}</p> : null}
            {report.reviewReason ? <p className="mt-3 text-sm">Última análise: {report.reviewReason}</p> : null}
            <form action={reviewReportAction} className="mt-4 grid gap-3 border-t border-app-border pt-4">
              <input type="hidden" name="reportId" value={report.id} />
              <label htmlFor={"review-" + report.id} className="font-semibold">Justificativa da análise</label>
              <textarea id={"review-" + report.id} name="reason" required minLength={10} maxLength={500} rows={2} className="ui-input" />
              <div className="flex flex-wrap gap-2">
                <button type="submit" name="state" value="in_review" className="ui-button ui-button-secondary">Em análise</button>
                <button type="submit" name="state" value="dismissed" className="ui-button ui-button-secondary">Descartar</button>
                <button type="submit" name="state" value="actioned" className="ui-button ui-button-secondary">Marcar resolvida</button>
              </div>
            </form>
            {report.moderationStatus ? (
              <form action={setPageModerationAction} className="mt-4 grid gap-3 border-t border-app-border pt-4">
                <input type="hidden" name="reportId" value={report.id} />
                <input type="hidden" name="profileId" value={report.profileId} />
                <label htmlFor={"moderate-" + report.id} className="font-semibold">Justificativa da suspensão ou reativação</label>
                <textarea id={"moderate-" + report.id} name="reason" required minLength={10} maxLength={500} rows={2} className="ui-input" />
                <div className="flex flex-wrap gap-2">
                  {report.moderationStatus === "active"
                    ? <button type="submit" name="suspend" value="yes" className="ui-button ui-button-secondary">Suspender página</button>
                    : <button type="submit" name="suspend" value="no" className="ui-button ui-button-secondary">Reativar página</button>}
                </div>
              </form>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
