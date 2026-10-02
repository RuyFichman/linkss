import { csvCell } from "@/modules/leads/service";
import type { DayRow } from "./dashboard";

/**
 * CSV of the daily aggregates of one page (ADR 0011). Aggregates only: no visitor row, hash,
 * address or referrer exists to export. Column names say what is counted; the timezone is a
 * column, so the file is self-describing after it leaves the product. Cells use the lead export's
 * escaping (quotes doubled, spreadsheet formulas neutralized).
 */
const COLUMNS = [
  "dia", "fuso_horario", "situacao_do_dia", "visitas_estimadas", "resultados", "cliques_em_links", "cliques_em_redes_sociais",
  "cliques_no_whatsapp", "copias_da_chave_pix", "cliques_no_link_de_pagamento", "envios_de_formulario", "videos_ou_musicas_carregados",
] as const;

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const STATUS_LABELS: Record<DayRow["status"], string> = {
  data: "com dados",
  zero: "sem visitas nem cliques",
  before_collection: "antes do início da contagem",
};

export function analyticsToCsv(rows: readonly DayRow[], timeZone: string): string {
  const lines = rows.map((row) => {
    // A day before collection has no numbers: empty cells, not zeros.
    const number = (value: number | undefined) => (row.status === "before_collection" ? "" : String(value ?? 0));
    return [
      row.day, timeZone, row.partial && row.status !== "before_collection" ? `${STATUS_LABELS[row.status]} (dia em andamento)` : STATUS_LABELS[row.status],
      number(row.visits), number(row.results), number(row.counts.link_click), number(row.counts.social_click),
      number(row.counts.whatsapp_click), number(row.counts.pix_copy), number(row.counts.pix_pay_click), number(row.counts.form_submit), number(row.counts.embed_load),
    ].map(csvCell).join(",");
  });
  // Byte-order mark so spreadsheet programs read accents as UTF-8.
  return `${BYTE_ORDER_MARK}${[COLUMNS.join(","), ...lines].join("\r\n")}\r\n`;
}
