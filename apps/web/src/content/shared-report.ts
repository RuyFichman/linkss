/**
 * Copy of the report a client reads at /r/<token> (ADR 0013). It is read by people outside the
 * product, usually on a phone, so it explains itself and uses no product vocabulary. The route is
 * server-rendered: nothing here is shipped to a browser bundle, and content/public-page.ts stays
 * the only copy file in the public page's client bundle.
 */
export const SHARED_REPORT_COPY = {
  metaTitle: "Relatório de resultados",
  kicker: (agency: string) => `Relatório de resultados · ${agency}`,
  address: "Endereço da página",
  period: (from: string, to: string, days: number) => (days === 1 ? `Dia ${from} (1 dia completo).` : `De ${from} a ${to} (${days} dias completos).`),
  timezone: "Os dias seguem o horário de Brasília.",
  summary: (visits: string, results: string, oneVisit: boolean, oneResult: boolean) =>
    `Neste período a página recebeu ${visits} ${oneVisit ? "visita" : "visitas"} e gerou ${results} ${oneResult ? "resultado" : "resultados"}.`,
  kpi: {
    title: "Resumo do período",
    visits: "Visitas",
    visitsHint: "estimativa",
    results: "Resultados",
    resultsHint: "WhatsApp, Pix e formulário",
    rate: "Resultados a cada 100 visitas",
    noRate: "Sem visitas no período",
  },
  resultTypes: {
    title: "De onde vieram os resultados",
    whatsapp_click: "Cliques no WhatsApp",
    pix_copy: "Cópias da chave Pix",
    pix_pay_click: "Cliques no link de pagamento",
    form_submit: "Envios de formulário",
  },
  series: {
    title: "Dia a dia",
    chartLabel: (from: string, to: string, peak: number, peakDay: string) => `Gráfico de visitas e resultados por dia, de ${from} a ${to}. O dia com mais visitas foi ${peakDay}, com ${peak}.`,
    legendVisits: "Barra larga: visitas",
    legendResults: "Barra estreita e escura: resultados",
    legendBefore: "Faixa listrada: dias sem contagem",
    table: "Números de cada dia",
    caption: "Visitas e resultados por dia",
    day: "Dia",
    visits: "Visitas",
    results: "Resultados",
    noNumber: "sem dado",
    total: "Total do período",
  },
  blocks: {
    title: "O que as pessoas mais clicaram",
    empty: "Nenhum clique registrado neste período.",
    clicks: (count: number) => (count === 1 ? "1 clique" : `${count} cliques`),
    perHundred: (value: string) => `${value} a cada 100 visitas`,
    isResult: "conta como resultado",
    removed: (name: string) => `${name} (não está mais na página)`,
    unnamed: "Bloco da página",
  },
  sources: {
    title: "De onde vieram as visitas",
    empty: "Nenhuma visita neste período.",
    visits: (count: number) => (count === 1 ? "1 visita" : `${count} visitas`),
    share: (value: string) => `${value}% das visitas`,
    others: "Outras origens",
    labels: {
      direct: "Direto ou sem origem", instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", tiktok: "TikTok", youtube: "YouTube",
      x: "X (Twitter)", linkedin: "LinkedIn", telegram: "Telegram", google: "Google", search: "Outros buscadores", other: "Outros sites",
    },
  },
  states: {
    not_available: { title: "Ainda não há números para mostrar", description: "A contagem de visitas desta página ainda não começou." },
    never_published: { title: "A página ainda não foi publicada", description: "Os números aparecem aqui depois que a página for ao ar e receber visitas." },
    before_collection: { title: "Ainda não há números para este período", description: "A contagem desta página começou depois deste período." },
    no_data_yet: { title: "Nenhuma visita registrada até agora", description: "A página está no ar. Os números aparecem aqui conforme as visitas chegarem." },
    zero: { title: "Nenhuma visita neste período", description: "A página não teve visitas nem cliques nestes dias." },
  },
  how: {
    title: "Como estes números são contados",
    items: [
      "Visita: uma abertura da página. Se a mesma pessoa abrir a página de novo em até 30 minutos, conta como a mesma visita.",
      "Resultado: clique no WhatsApp, cópia da chave Pix, clique no link de pagamento ou envio de formulário.",
      "Os números são estimativas: robôs e prévias de link não entram, e quem bloqueia scripts não é contado.",
      "Nenhuma pessoa é identificada: o relatório mostra só totais.",
    ],
  },
  expires: (when: string) => `Este link funciona até ${when}.`,
  readOnly: "Relatório somente leitura.",
  badge: (product: string) => `Relatório gerado com ${product}.`,
  unavailable: {
    title: "Relatório não disponível",
    description: "Este link não abre um relatório. Ele pode ter expirado ou sido cancelado, ou o endereço pode estar incompleto. Peça um novo link a quem enviou.",
  },
} as const;
