import type { SHARED_REPORT_COPY as PORTUGUESE } from "./shared-report";
import type { Widen } from "./types";

/** The report a client reads at /r/<token>, in Spanish, for pages whose owner chose Spanish (ADR 0022). */
export const SHARED_REPORT_COPY = {
  metaTitle: "Informe de resultados",
  kicker: (agency: string) => `Informe de resultados · ${agency}`,
  address: "Dirección de la página",
  period: (from: string, to: string, days: number) => (days === 1 ? `Día ${from} (1 día completo).` : `Del ${from} al ${to} (${days} días completos).`),
  timezone: "Los días siguen la hora de Brasilia.",
  summary: (visits: string, results: string, oneVisit: boolean, oneResult: boolean) =>
    `En este periodo la página recibió ${visits} ${oneVisit ? "visita" : "visitas"} y generó ${results} ${oneResult ? "resultado" : "resultados"}.`,
  kpi: {
    title: "Resumen del periodo",
    visits: "Visitas",
    visitsHint: "estimación",
    results: "Resultados",
    resultsHint: "WhatsApp, Pix y formulario",
    rate: "Resultados por cada 100 visitas",
    noRate: "Sin visitas en el periodo",
  },
  resultTypes: {
    title: "De dónde vinieron los resultados",
    whatsapp_click: "Clics en WhatsApp",
    pix_copy: "Copias de la clave Pix",
    pix_pay_click: "Clics en el enlace de pago",
    form_submit: "Envíos de formulario",
  },
  series: {
    title: "Día a día",
    chartLabel: (from: string, to: string, peak: number, peakDay: string) => `Gráfico de visitas y resultados por día, del ${from} al ${to}. El día con más visitas fue el ${peakDay}, con ${peak}.`,
    legendVisits: "Barra ancha: visitas",
    legendResults: "Barra estrecha y oscura: resultados",
    legendBefore: "Franja rayada: días sin recuento",
    table: "Cifras de cada día",
    caption: "Visitas y resultados por día",
    day: "Día",
    visits: "Visitas",
    results: "Resultados",
    noNumber: "sin dato",
    total: "Total del periodo",
  },
  blocks: {
    title: "Lo que más se ha pulsado",
    empty: "Ningún clic registrado en este periodo.",
    clicks: (count: number) => (count === 1 ? "1 clic" : `${count} clics`),
    perHundred: (value: string) => `${value} por cada 100 visitas`,
    isResult: "cuenta como resultado",
    removed: (name: string) => `${name} (ya no está en la página)`,
    unnamed: "Bloque de la página",
  },
  sources: {
    title: "De dónde vinieron las visitas",
    empty: "Ninguna visita en este periodo.",
    visits: (count: number) => (count === 1 ? "1 visita" : `${count} visitas`),
    share: (value: string) => `${value} % de las visitas`,
    others: "Otros orígenes",
    labels: {
      direct: "Directo o sin origen", instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", tiktok: "TikTok", youtube: "YouTube",
      x: "X (Twitter)", linkedin: "LinkedIn", telegram: "Telegram", google: "Google", search: "Otros buscadores", other: "Otras webs",
    },
  },
  states: {
    not_available: { title: "Todavía no hay cifras que mostrar", description: "El recuento de visitas de esta página todavía no ha empezado." },
    never_published: { title: "La página todavía no se ha publicado", description: "Las cifras aparecerán aquí cuando la página se publique y reciba visitas." },
    before_collection: { title: "Todavía no hay cifras para este periodo", description: "El recuento de esta página empezó después de este periodo." },
    no_data_yet: { title: "Ninguna visita registrada hasta ahora", description: "La página está publicada. Las cifras aparecerán aquí a medida que lleguen visitas." },
    zero: { title: "Ninguna visita en este periodo", description: "La página no ha tenido visitas ni clics en estos días." },
  },
  how: {
    title: "Cómo se cuentan estas cifras",
    items: [
      "Visita: una apertura de la página. Si la misma persona abre la página otra vez en menos de 30 minutos, cuenta como la misma visita.",
      "Resultado: clic en WhatsApp, copia de la clave Pix, clic en el enlace de pago o envío de formulario.",
      "Las cifras son estimaciones: no cuentan robots ni vistas previas de enlaces, y no se cuenta a quien bloquea scripts.",
      "No se identifica a ninguna persona: el informe solo muestra totales.",
    ],
  },
  expires: (when: string) => `Este enlace funciona hasta el ${when}.`,
  readOnly: "Informe de solo lectura.",
  badge: (product: string) => `Informe generado con ${product}.`,
  unavailable: {
    title: "Informe no disponible",
    description: "Este enlace no abre ningún informe. Puede que haya caducado o se haya cancelado, o que la dirección esté incompleta. Pide un nuevo enlace a quien te lo envió.",
  },
} as const satisfies Widen<typeof PORTUGUESE>;
