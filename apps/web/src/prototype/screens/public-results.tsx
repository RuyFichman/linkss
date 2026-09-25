"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BioPage } from "@/modules/publishing/render/bio-page";
import { Badge, Button, EmptyState, Skeleton } from "@/ui";
import { COPY } from "@/content/pt-BR";
import { usePrototype } from "../store";

const number = new Intl.NumberFormat("pt-BR");

export function PublicPageScreen() {
  const params = useParams<{ slug: string }>(); const { state } = usePrototype(); const profile = state.profiles.find((item) => item.slug === params.slug);
  if (!profile) return <main className="app-shell grid min-h-screen place-items-center py-16"><EmptyState title="Página não encontrada" description="Confira o endereço ou volte ao início do protótipo." action={<Link className="ui-button ui-button-primary" href="/proto">Ir ao início</Link>} /></main>;
  if (profile.status === "draft" || profile.status === "archived") return <main className="app-shell grid min-h-screen place-items-center py-16"><EmptyState title="Página não publicada" description="Esta página existe como rascunho, mas ainda não está disponível para visitantes." action={<Link className="ui-button ui-button-primary" href={`/proto/editor/${profile.id}`}>Abrir editor</Link>} /></main>;
  return <main className="min-h-screen"><BioPage document={profile} /></main>;
}

export function AnalyticsScreen() {
  const params = useParams<{ profileId: string }>(); const { state, record } = usePrototype(); const profile = state.profiles.find((item) => item.id === params.profileId); const [period, setPeriod] = useState<7 | 30 | 90>(7); const mode = state.debug.analyticsMode;
  if (!profile) return <main className="app-shell py-20"><EmptyState title="Página não encontrada" description="Abra os resultados a partir de uma página existente." action={<Link className="ui-button ui-button-primary" href="/proto">Voltar</Link>} /></main>;
  const freeLocked = profile.plan === "free" && period > 7;
  const selectPeriod = (value: 7 | 30 | 90) => { setPeriod(value); record("analytics_viewed", `${profile.id}:${value}`); };
  return <main className="app-shell py-16"><div className="flex flex-wrap items-start justify-between gap-4"><div><Link className="font-bold text-app-accent" href={`/proto/editor/${profile.id}`}>← Voltar ao editor</Link><h1 className="mt-5 text-4xl font-bold">Resultados de {profile.title}</h1><p className="mt-2 text-app-muted">Números fictícios para validar a compreensão do relatório.</p></div><Badge>Fuso: America/Sao_Paulo</Badge></div><div className="mt-8 flex flex-wrap gap-2" aria-label="Período dos resultados">{([7, 30, 90] as const).map((value) => <Button key={value} variant={period === value ? "primary" : "secondary"} onClick={() => selectPeriod(value)}>{value} dias {profile.plan === "free" && value > 7 ? "🔒" : ""}</Button>)}</div>{freeLocked ? <div className="mt-5 rounded-xl bg-app-accent/10 p-4 text-app-accent"><b>O plano gratuito mostra os últimos 7 dias.</b><p className="mt-1">Períodos maiores fazem parte das hipóteses de planos futuros; não há compra real neste protótipo.</p></div> : null}
    {mode === "loading" ? <section className="mt-8 grid gap-5" role="status" aria-label="Carregando resultados"><Skeleton height={110} /><Skeleton height={240} /><span className="sr-only">Carregando resultados…</span></section> : null}
    {mode === "error" ? <section className="mt-8 rounded-2xl bg-app-danger/10 p-6 text-app-danger" role="alert"><h2 className="text-xl font-bold">Não foi possível carregar os resultados.</h2><p className="mt-2">Tente novamente. A página pública continua funcionando normalmente.</p></section> : null}
    {mode === "no-data" ? <section className="mt-8"><EmptyState title="Sem dados ainda" description={COPY.analytics.noData} action={<Button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/proto/p/${profile.slug}`)}>Copiar link da página</Button>} /></section> : null}
    {mode === "zero" ? <section className="mt-8"><EmptyState title="Zero neste período" description={`${COPY.analytics.zero} A página já teve atividade em outros períodos.`} /></section> : null}
    {mode === "data" && !freeLocked ? <AnalyticsData period={period} /> : null}
  </main>;
}

function AnalyticsData({ period }: { period: 7 | 30 | 90 }) {
  const factor = period === 7 ? 0.28 : period === 30 ? 1 : 2.7; const visits = Math.round(1240 * factor); const clicks = Math.round(342 * factor); const actions = Math.round(87 * factor); const rate = visits ? ((actions / visits) * 100).toFixed(1).replace(".", ",") : "0,0";
  return <div className="mt-8 grid gap-6"><section className="grid gap-4 sm:grid-cols-3">{[["Visitas", number.format(visits)],["Resultados", number.format(actions)],["Taxa de resultado", `${rate}%`]].map(([label, value]) => <div key={label} className="surface-card p-5"><p className="text-sm font-bold text-app-muted">{label}</p><strong className="mt-2 block text-3xl">{value}</strong></div>)}</section><div className="grid gap-6 lg:grid-cols-2"><section className="surface-card p-6"><h2 className="text-2xl font-bold">Caminho até o resultado</h2><div className="mt-6 grid gap-4"><FunnelBar label="Visitas" value={visits} max={visits} /><FunnelBar label="Cliques" value={clicks} max={visits} /><FunnelBar label="Resultados" value={actions} max={visits} /></div></section><section className="surface-card p-6"><h2 className="text-2xl font-bold">Blocos com mais resultado</h2><ol className="mt-5 grid gap-4"><li><RankBar label="WhatsApp" value={58} max={58} /></li><li><RankBar label="Agenda" value={21} max={58} /></li><li><RankBar label="Catálogo" value={8} max={58} /></li></ol></section><section className="surface-card p-6 lg:col-span-2"><h2 className="text-2xl font-bold">Origem das visitas</h2><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[["Instagram",52],["TikTok",18],["WhatsApp",14],["Direto",10],["Outros",6]].map(([label, value]) => <div key={label} className="rounded-xl bg-app-surface-soft p-4"><b>{label}</b><strong className="mt-1 block text-2xl">{value}%</strong></div>)}</div><p className="mt-4 text-sm text-app-muted">UTM em destaque: <b>instagram / bio / campanha-setembro</b>.</p></section></div><p className="text-sm text-app-muted">Período encerrado em 25/09/2026 • America/Sao_Paulo • dados fictícios.</p></div>;
}

function FunnelBar({ label, value, max }: { label: string; value: number; max: number }) { const width = Math.max(8, Math.round((value / max) * 100)); return <div><div className="mb-1 flex justify-between gap-4"><b>{label}</b><span>{number.format(value)}</span></div><div className="h-9 overflow-hidden rounded-lg bg-app-surface-soft"><div className="grid h-full place-items-center bg-app-accent text-sm font-bold text-white" style={{ width: `${width}%` }}>{width}%</div></div></div>; }
function RankBar({ label, value, max }: { label: string; value: number; max: number }) { return <div><div className="mb-1 flex justify-between"><b>{label}</b><span>{value}</span></div><div className="h-3 rounded-full bg-app-surface-soft"><div className="h-full rounded-full bg-app-success" style={{ width: `${Math.round((value / max) * 100)}%` }} /></div></div>; }
