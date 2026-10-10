import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requestAccountDeletionAction, requestDataAccessAction } from "@/modules/privacy/actions";
import { myLegalHistory, myPrivacyRequests } from "@/modules/privacy/server";
import { resolveAccount } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Meus dados e privacidade" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  received: "Recebida",
  needs_action: "Aguardando providência",
  processing: "Em análise",
  completed: "Concluída",
  rejected: "Não atendida",
};
const REASON: Record<string, string> = {
  active_subscription: "Há uma assinatura em curso. O cancelamento no provedor e a situação da cobrança precisam ser conferidos antes da exclusão.",
  shared_workspace: "Há outras pessoas numa conta que você administra. A transferência ou o encerramento da conta compartilhada precisa ser definido.",
  manual_review: "A equipe precisa conferir os stores e eventuais retenções aplicáveis.",
  fulfilled: "Atendimento documentado.",
  cannot_verify: "A identidade ou o escopo não pôde ser confirmado.",
};

export default async function MyDataPage({ searchParams }: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const account = await resolveAccount();
  if (account.status === "anonymous") redirect("/entrar?next=/app/conta/dados");
  if (account.status !== "ready") return null;
  const [requests, history] = await Promise.all([myPrivacyRequests(), myLegalHistory()]);
  const { erro } = await searchParams;
  const owned = account.workspaces.filter((workspace) => workspace.role === "owner");

  return (
    <section className="app-shell max-w-4xl">
      <h1 className="text-3xl font-bold">Meus dados e privacidade</h1>
      <p className="mt-3 text-app-muted">Baixe os dados disponíveis agora ou registre um pedido para análise dos demais stores. Os arquivos incluem dados pessoais: guarde-os em local seguro.</p>
      {erro ? <p role="alert" className="mt-4 text-red-700">Não foi possível registrar o pedido. Tente novamente.</p> : null}

      <div className="mt-6 grid gap-5">
        <section className="surface-card p-5">
          <h2 className="text-xl font-bold">Exportação da pessoa</h2>
          <p className="mt-2 text-sm text-app-muted">Inclui cadastro, autenticação sem credenciais, participação em contas, convites relacionados, aceites e auditoria da sua pessoa.</p>
          <form action="/app/conta/dados/exportar" method="post" className="mt-4">
            <button className="ui-button ui-button-secondary" type="submit">Baixar meus dados em JSON</button>
          </form>
        </section>
        <section className="surface-card p-5">
          <h2 className="text-xl font-bold">Dados de contas que você administra</h2>
          <p className="mt-2 text-sm text-app-muted">Apenas proprietários podem exportar rascunhos, publicações, contatos, resultados agregados, convites, relatórios e cobrança da conta. O JSON traz o inventário da mídia; o pacote dos arquivos deve ser solicitado abaixo.</p>
          {owned.length === 0 ? <p className="mt-3 text-sm">Você não é proprietário de nenhuma conta.</p> : (
            <ul className="mt-4 grid gap-3">
              {owned.map((workspace) => (
                <li key={workspace.workspaceId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border p-3">
                  <span>{workspace.name}</span>
                  <form action={"/app/conta/dados/exportar?workspace=" + encodeURIComponent(workspace.workspaceId)} method="post">
                    <button className="ui-button ui-button-secondary" type="submit">Baixar JSON desta conta</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={requestDataAccessAction} className="mt-4">
            <button className="ui-button ui-button-secondary" type="submit">Solicitar pacote completo e conferência</button>
          </form>
        </section>
        <section className="surface-card p-5">
          <h2 className="text-xl font-bold">Solicitar exclusão da conta pessoal</h2>
          <p className="mt-2 text-sm text-app-muted">O pedido não apaga dados imediatamente. Antes da conclusão, a equipe verifica assinaturas em curso, dados de outras pessoas em contas compartilhadas, publicações e retenções aplicáveis. Você verá o estado do pedido aqui.</p>
          <form action={requestAccountDeletionAction} className="mt-4">
            <button className="ui-button ui-button-secondary" type="submit">Registrar solicitação de exclusão</button>
          </form>
        </section>
        <section className="surface-card p-5">
          <h2 className="text-xl font-bold">Histórico de pedidos</h2>
          {requests.length === 0 ? <p className="mt-2 text-app-muted">Nenhum pedido registrado.</p> : (
            <ul className="mt-3 grid gap-3">
              {requests.map((request) => (
                <li key={request.id} className="rounded-xl border border-app-border p-3">
                  <b>{request.kind === "account_deletion" ? "Exclusão da conta" : "Acesso aos dados"} — {STATUS[request.status] ?? request.status}</b>
                  <p className="text-sm text-app-muted">{new Date(request.createdAt).toLocaleString("pt-BR")}</p>
                  {request.reason ? <p className="mt-1 text-sm">{REASON[request.reason] ?? "Em análise."}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="surface-card p-5">
          <h2 className="text-xl font-bold">Histórico de aceites</h2>
          {history.length === 0 ? <p className="mt-2 text-app-muted">Nenhum aceite versionado registrado.</p> : (
            <ul className="mt-3 grid gap-2 text-sm">
              {history.map((item) => <li key={item.kind + item.version + item.acceptedAt}>{item.kind} {item.version} — {new Date(item.acceptedAt).toLocaleString("pt-BR")} — hash {item.sha256.slice(0, 12)}…</li>)}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
