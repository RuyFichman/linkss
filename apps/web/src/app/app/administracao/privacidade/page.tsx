import { formatDateTime } from "@/lib/format-date";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";
import { eraseAccountAction, reviewPrivacyRequestAction } from "./actions";

export const metadata: Metadata = { title: "Pedidos de privacidade" };
export const dynamic = "force-dynamic";

interface RequestItem {
  id: string;
  userId: string;
  email: string | null;
  kind: "account_deletion" | "data_access";
  status: string;
  reason: string | null;
  evidenceReference: string | null;
  createdAt: string;
}

/** What the operator reads after running an erasure, by outcome (docs/runbooks/ACCOUNT_DELETION.md). */
const ERASURE_MESSAGES: Record<string, string> = {
  erased: "Conta excluída. O pedido foi concluído com a referência informada. Responda ao titular seguindo o runbook, incluindo o aviso sobre os backups.",
  confirmation: "Nada foi feito: digite EXCLUIR no campo de confirmação.",
  invalid_evidence: "Nada foi feito: informe a referência do dossiê (4 a 120 caracteres, sem dados pessoais).",
  not_processing: "Nada foi excluído: o pedido precisa ser de exclusão e estar em análise. Se algo foi criado na conta depois do início, execute de novo.",
  active_subscription: "Nada foi feito: há uma assinatura em curso numa conta desta pessoa. Ela precisa terminar antes (runbook, passo 2).",
  shared_workspace: "Nada foi feito: uma conta desta pessoa tem outros membros. Eles precisam sair ou a conta ser transferida antes (runbook, passo 2).",
  domain_failed: "As páginas saíram do ar, mas um domínio próprio não pôde ser desanexado no provedor. Nada foi excluído. Execute de novo.",
  media_pending: "As páginas saíram do ar, mas ainda há imagens sendo removidas. Nada foi excluído. Execute de novo em alguns minutos.",
  media_not_configured: "As páginas saíram do ar, mas a limpeza de imagens não está configurada neste ambiente. Nada foi excluído.",
  not_deployed: "A exclusão ainda não está disponível neste ambiente (migração pendente).",
  unavailable: "Não foi possível concluir agora. Nada foi excluído além do que a mensagem anterior indicou. Execute de novo.",
};

export default async function PrivacyQueue({ searchParams }: {
  searchParams: Promise<{ erro?: string; exclusao?: string }>;
}) {
  if (!(await getCurrentUserId())) redirect("/entrar");
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("list_privacy_requests");
  if (error?.code === "42501") notFound();
  const requests = Array.isArray(data) ? data as unknown as RequestItem[] : [];
  const { erro, exclusao } = await searchParams;
  const erasureMessage = exclusao ? ERASURE_MESSAGES[exclusao] : undefined;
  return (
    <section className="app-shell max-w-5xl">
      <h1 className="text-3xl font-bold">Pedidos de privacidade</h1>
      <p className="mt-2 text-app-muted">Últimos 100 pedidos. Confira identidade, escopo, outras pessoas na conta, assinatura e cada store do inventário antes de concluir. Registre uma referência ao dossiê de evidências, sem incluir dados pessoais neste campo.</p>
      {error ? <p role="alert" className="mt-4 text-red-700">Fila indisponível neste ambiente.</p> : null}
      {erro ? <p role="alert" className="mt-4 text-red-700">A mudança foi recusada. Confira o estado e a evidência.</p> : null}
      {erasureMessage ? <p role={exclusao === "erased" ? "status" : "alert"} className={exclusao === "erased" ? "mt-4 rounded-xl border border-app-success/30 bg-app-success/10 p-3 text-app-success" : "mt-4 rounded-xl border border-app-danger/30 bg-app-danger/10 p-3 text-app-danger"}>{erasureMessage}</p> : null}
      {!error && requests.length === 0 ? <p className="mt-6 rounded-xl border border-app-border p-5">Nenhum pedido registrado.</p> : null}
      <div className="mt-6 grid gap-5">
        {requests.map((item) => (
          <article className="surface-card p-5" key={item.id}>
            <h2 className="text-xl font-bold">{item.kind === "account_deletion" ? "Exclusão" : "Acesso aos dados"} · {item.status}</h2>
            <p className="mt-1 text-sm">{item.email ?? item.userId}</p>
            <p className="text-sm text-app-muted">{formatDateTime(item.createdAt)} · motivo: {item.reason ?? "não definido"}</p>
            {item.evidenceReference ? <p className="text-sm">Referência: {item.evidenceReference}</p> : null}
            <form action={reviewPrivacyRequestAction} className="mt-4 grid gap-3 border-t border-app-border pt-4">
              <input type="hidden" name="requestId" value={item.id} />
              <label htmlFor={"reason-" + item.id}>Motivo da decisão</label>
              <select id={"reason-" + item.id} name="reason" required className="ui-input" defaultValue={item.reason ?? "manual_review"}>
                <option value="manual_review">Revisão manual</option>
                <option value="active_subscription">Assinatura em curso</option>
                <option value="shared_workspace">Conta compartilhada</option>
                <option value="fulfilled">Atendido</option>
                <option value="cannot_verify">Identidade não confirmada</option>
              </select>
              <label htmlFor={"evidence-" + item.id}>Referência da evidência, sem dados pessoais</label>
              <input id={"evidence-" + item.id} name="evidence" minLength={4} maxLength={120} className="ui-input" defaultValue={item.evidenceReference ?? ""} />
              <div className="flex flex-wrap gap-2">
                <button type="submit" name="status" value="processing" className="ui-button ui-button-secondary">Em análise</button>
                <button type="submit" name="status" value="needs_action" className="ui-button ui-button-secondary">Aguardando providência</button>
                <button type="submit" name="status" value="completed" className="ui-button ui-button-secondary">Concluir com evidência</button>
                <button type="submit" name="status" value="rejected" className="ui-button ui-button-secondary">Não atender</button>
              </div>
            </form>
            {item.kind === "account_deletion" && item.status === "processing" ? (
              <form action={eraseAccountAction} className="mt-4 grid gap-3 rounded-xl border border-app-danger/30 bg-app-danger/10 p-4">
                <input type="hidden" name="requestId" value={item.id} />
                <h3 className="text-lg font-bold text-app-danger">Executar a exclusão</h3>
                <p className="m-0 text-sm">Tira do ar e apaga em definitivo as páginas, imagens, contatos, resultados e contas que pertencem a esta pessoa, e a conta de acesso. Não pode ser desfeito. Faça antes as conferências do runbook de exclusão de conta.</p>
                <label htmlFor={"erase-evidence-" + item.id}>Referência do dossiê, sem dados pessoais</label>
                <input id={"erase-evidence-" + item.id} name="evidence" required minLength={4} maxLength={120} className="ui-input" />
                <label htmlFor={"erase-confirm-" + item.id}>Para confirmar, digite EXCLUIR</label>
                <input id={"erase-confirm-" + item.id} name="confirmation" required autoComplete="off" autoCapitalize="characters" className="ui-input" />
                <div><button type="submit" className="ui-button ui-button-danger">Excluir a conta em definitivo</button></div>
              </form>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
