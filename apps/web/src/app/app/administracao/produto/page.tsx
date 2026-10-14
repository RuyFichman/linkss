import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BILLING_COPY } from "@/content/pt-BR";
import { formatDateTime } from "@/lib/format-date";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";
import { ACTIVATION_GATE_PERCENT, PUBLISH_MEDIAN_TARGET_MINUTES, activation, funnelRows, parseProductMetrics, rate, type FunnelStep } from "@/modules/product-metrics/metrics";

export const metadata: Metadata = { title: "Funil do produto" };
export const dynamic = "force-dynamic";

const STEP: Record<FunnelStep, string> = {
  signedUp: "Criaram a conta",
  confirmed: "Confirmaram o e-mail",
  createdPage: "Criaram uma página",
  published: "Publicaram",
  visited: "Receberam uma visita",
  valueAction: "Receberam uma ação de valor",
  paid: "Pagaram",
};

const TH = "py-2 pr-4 font-bold";
const TD = "py-2 pr-4";

function percent(value: number | null): string {
  return value === null ? "sem dados" : `${value}%`;
}

/** "13/10" from "2026-10-13": the Monday the cohort's week starts on. */
function weekLabel(weekStart: string): string {
  const [, month, day] = weekStart.split("-");
  return `${day}/${month}`;
}

/**
 * Product funnel and activation cohorts (ADR 0020), for platform administrators. Everything shown
 * is a count the database computed from existing records; this screen adds only percentages. A
 * rate with nothing to divide by is shown as "sem dados", never as 0%.
 */
export default async function ProductMetricsPage() {
  if (!(await getCurrentUserId())) redirect("/entrar");
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_product_metrics");
  if (error?.code === "42501") notFound();
  const metrics = error ? null : parseProductMetrics(data);

  if (!metrics) {
    return (
      <section className="app-shell max-w-5xl">
        <h1 className="text-3xl font-bold">Funil do produto</h1>
        <p role="alert" className="mt-4 rounded-xl border border-app-border p-5">
          {error && isMissingSchemaError(error) ? "O funil ainda não está disponível neste ambiente (migração pendente)." : "Não foi possível carregar o funil agora. Tente novamente em instantes."}
        </p>
      </section>
    );
  }

  const { totals } = metrics;
  const active = activation(totals);
  const median = totals.medianMinutesToPublish;
  const cancellations = metrics.cancellationReasons.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="app-shell grid max-w-5xl gap-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold">Funil do produto</h1>
        <p className="m-0 text-app-muted">
          Contas criadas nas últimas {metrics.weeks} semanas e até onde cada uma chegou. Calculado em {formatDateTime(metrics.generatedAt)} (horário de Brasília) a partir do que o produto já registra: nada é coletado para esta tela.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <article className="surface-card grid gap-2 p-5" aria-labelledby="ativacao-titulo">
          <h2 id="ativacao-titulo" className="text-xl font-bold">Ativação</h2>
          <p className="m-0 text-3xl font-bold">{percent(active.percent)}</p>
          <p className="m-0 text-sm">
            {active.meetsGate === null
              ? "Nenhuma conta criada no período: não há o que medir ainda."
              : `${totals.published} de ${totals.signedUp} contas publicaram uma página. ${active.meetsGate ? "Está no gate" : "Está abaixo do gate"} de ${ACTIVATION_GATE_PERCENT}% da Sprint 10.`}
          </p>
          <p className="m-0 text-sm text-app-muted">Em até 24 horas do cadastro: {percent(active.within24hPercent)}.</p>
        </article>
        <article className="surface-card grid gap-2 p-5" aria-labelledby="mediana-titulo">
          <h2 id="mediana-titulo" className="text-xl font-bold">Tempo até publicar</h2>
          <p className="m-0 text-3xl font-bold">{median === null ? "sem dados" : `${median.toLocaleString("pt-BR")} min`}</p>
          <p className="m-0 text-sm">
            {median === null
              ? "Nenhuma conta do período publicou ainda."
              : `Mediana entre o cadastro e a primeira publicação, das contas que publicaram. ${median < PUBLISH_MEDIAN_TARGET_MINUTES ? "Está dentro" : "Está acima"} da meta de menos de ${PUBLISH_MEDIAN_TARGET_MINUTES} minutos.`}
          </p>
        </article>
      </div>

      <section className="surface-card grid gap-4 p-5 sm:p-6" aria-labelledby="funil-titulo">
        <h2 id="funil-titulo" className="text-xl font-bold">Funil do período</h2>
        {/* Wider than a phone: the region takes focus so the keyboard can scroll it. */}
        <div className="overflow-x-auto" role="region" aria-labelledby="funil-titulo" tabIndex={0}>
          <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
            <caption className="sr-only">Contas em cada etapa, com a parte das contas criadas e a parte da etapa anterior</caption>
            <thead>
              <tr className="border-b border-app-border text-app-muted">
                <th scope="col" className={TH}>Etapa</th>
                <th scope="col" className={TH}>Contas</th>
                <th scope="col" className={TH}>Das contas criadas</th>
                <th scope="col" className={TH}>Da etapa anterior</th>
              </tr>
            </thead>
            <tbody>
              {funnelRows(totals).map((row) => (
                <tr key={row.step} className="border-b border-app-border last:border-0">
                  <th scope="row" className={`${TD} font-normal`}>{STEP[row.step]}</th>
                  <td className={TD}>{row.count}</td>
                  <td className={TD}>{percent(row.ofSignedUp)}</td>
                  <td className={TD}>{row.ofPrevious === null ? (row.step === "signedUp" ? "—" : "sem dados") : `${row.ofPrevious}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-card grid gap-4 p-5 sm:p-6" aria-labelledby="coortes-titulo">
        <div className="grid gap-1">
          <h2 id="coortes-titulo" className="text-xl font-bold">Coortes por semana de cadastro</h2>
          <p className="m-0 text-sm text-app-muted">Cada linha são as contas criadas na semana que começa na segunda-feira indicada. As etapas contam o que essas contas fizeram até hoje.</p>
        </div>
        <div className="overflow-x-auto" role="region" aria-labelledby="coortes-titulo" tabIndex={0}>
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <caption className="sr-only">Contas criadas por semana e quantas chegaram a cada etapa</caption>
            <thead>
              <tr className="border-b border-app-border text-app-muted">
                <th scope="col" className={TH}>Semana de</th>
                <th scope="col" className={TH}>Contas</th>
                <th scope="col" className={TH}>Criaram página</th>
                <th scope="col" className={TH}>Publicaram</th>
                <th scope="col" className={TH}>Ativação</th>
                <th scope="col" className={TH}>Em 24 h</th>
                <th scope="col" className={TH}>Ação de valor</th>
                <th scope="col" className={TH}>Pagaram</th>
              </tr>
            </thead>
            <tbody>
              {metrics.cohorts.map((cohort) => (
                <tr key={cohort.weekStart} className="border-b border-app-border last:border-0">
                  <th scope="row" className={`${TD} font-normal`}>{weekLabel(cohort.weekStart)}</th>
                  <td className={TD}>{cohort.signedUp}</td>
                  <td className={TD}>{cohort.createdPage}</td>
                  <td className={TD}>{cohort.published}</td>
                  <td className={TD}>{percent(rate(cohort.published, cohort.signedUp))}</td>
                  <td className={TD}>{percent(rate(cohort.published24h, cohort.signedUp))}</td>
                  <td className={TD}>{cohort.valueAction}</td>
                  <td className={TD}>{cohort.paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-card grid gap-4 p-5 sm:p-6" aria-labelledby="cancelamentos-titulo">
        <div className="grid gap-1">
          <h2 id="cancelamentos-titulo" className="text-xl font-bold">Motivos de cancelamento</h2>
          <p className="m-0 text-sm text-app-muted">Respostas dadas na tela de cancelamento, desde sempre. A pergunta é opcional, e quem cancela pela página do provedor de pagamento não a vê: o total abaixo é o de respostas, não o de cancelamentos.</p>
        </div>
        {cancellations === 0 ? <p className="m-0">Nenhuma resposta até agora.</p> : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {metrics.cancellationReasons.map((item) => (
              <li key={item.reason} className="flex flex-wrap justify-between gap-3 border-b border-app-border py-2 last:border-0">
                <span>{BILLING_COPY.cancelReason.options[item.reason]}</span>
                <span>{item.count} ({percent(rate(item.count, cancellations))})</span>
              </li>
            ))}
          </ul>
        )}
        {metrics.cancellationComments.length > 0 ? (
          <div className="grid gap-2">
            <h3 className="text-lg font-bold">Comentários mais recentes</h3>
            <p className="m-0 text-sm text-app-muted">Texto escrito por quem cancelou. Pode conter dados pessoais: não copie para fora desta tela.</p>
            <ul className="m-0 grid list-none gap-2 p-0">
              {metrics.cancellationComments.map((item, index) => (
                <li key={`${item.createdAt}-${index}`} className="rounded-xl border border-app-border p-3">
                  <p className="m-0 text-sm text-app-muted">{formatDateTime(item.createdAt)} · {BILLING_COPY.cancelReason.options[item.reason]}{item.planId ? ` · plano ${BILLING_COPY.planNames[item.planId]}` : ""}</p>
                  <p className="m-0 mt-1 whitespace-pre-wrap break-words">{item.comment}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="grid gap-2 text-sm text-app-muted" aria-labelledby="limites-titulo">
        <h2 id="limites-titulo" className="text-base font-bold text-app-text">Como ler estes números</h2>
        <ul className="m-0 grid list-disc gap-1 pl-5">
          <li>Entram todas as contas criadas no período, convidadas ou não. O gate da Sprint 10 fala de convidados: durante o piloto fechado os dois grupos coincidem.</li>
          <li>Contas já excluídas e as de administradores da plataforma não são contadas.</li>
          <li>Visitas e ações de valor vêm dos totais diários, guardados por 100 dias: por isso o período máximo é de 12 semanas.</li>
          <li>Cada conta é contada pelo que ela mesma criou ou publicou, em qualquer conta de que participe.</li>
          <li>Em ambiente de teste da cobrança, &quot;Pagaram&quot; conta pagamentos de teste.</li>
        </ul>
      </section>
    </section>
  );
}
