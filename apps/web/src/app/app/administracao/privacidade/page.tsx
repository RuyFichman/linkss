import { formatDateTime } from "@/lib/format-date";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";
import { reviewPrivacyRequestAction } from "./actions";

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

export default async function PrivacyQueue({ searchParams }: {
  searchParams: Promise<{ erro?: string }>;
}) {
  if (!(await getCurrentUserId())) redirect("/entrar");
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("list_privacy_requests");
  if (error?.code === "42501") notFound();
  const requests = Array.isArray(data) ? data as unknown as RequestItem[] : [];
  const { erro } = await searchParams;
  return (
    <section className="app-shell max-w-5xl">
      <h1 className="text-3xl font-bold">Pedidos de privacidade</h1>
      <p className="mt-2 text-app-muted">Últimos 100 pedidos. Confira identidade, escopo, outras pessoas na conta, assinatura e cada store do inventário antes de concluir. Registre uma referência ao dossiê de evidências, sem incluir dados pessoais neste campo.</p>
      {error ? <p role="alert" className="mt-4 text-red-700">Fila indisponível neste ambiente.</p> : null}
      {erro ? <p role="alert" className="mt-4 text-red-700">A mudança foi recusada. Confira o estado e a evidência.</p> : null}
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
          </article>
        ))}
      </div>
    </section>
  );
}
