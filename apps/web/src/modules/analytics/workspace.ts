import { csvCell } from "@/modules/leads/service";
import { ANALYTICS_EVENT_TYPES, isAnalyticsEventType } from "./contract";
import { dashboardState, parseAnalyticsReport, totalsFromCounts, type AnalyticsReport, type DashboardState, type EventCounts, type Totals } from "./dashboard";
import { isDay } from "./dates";

/**
 * Consolidated view model of a workspace (ADR 0013). Pure functions over the object that
 * public.get_workspace_analytics() returns. Every number is produced by the functions of
 * ./dashboard, so a visit, a result and a rate mean here what they mean in a page's own dashboard.
 */
export type PageStatus = "draft" | "published" | "archived";

export interface WorkspacePage {
  profileId: string;
  title: string;
  slug: string;
  status: PageStatus;
  everPublished: boolean;
  /** First day this page could have data. */
  collectingSince: string;
  /** First day with any event of this page across the retained history, or null. */
  firstEventDay: string | null;
  /** Counts of the period, already summed. */
  counts: EventCounts;
}

/** The workspace's totals in the shape of a page report, plus one row per listed page. */
export interface WorkspaceReport extends AnalyticsReport {
  pages: WorkspacePage[];
  /** Pages alive in the workspace (not deleted), listed or not. */
  pageCount: number;
  /** Pages left out of the table: off the air and without events in the period. */
  pagesOmitted: number;
  /** True when there are more listed pages than the read returns; totals still cover all of them. */
  pagesTruncated: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_STATUSES: readonly string[] = ["draft", "published", "archived"];

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function parseCounts(value: unknown): EventCounts {
  const counts: EventCounts = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return counts;
  for (const [type, total] of Object.entries(value)) {
    if (isAnalyticsEventType(type) && typeof total === "number" && Number.isInteger(total) && total > 0) counts[type] = total;
  }
  return counts;
}

function parsePage(value: unknown): WorkspacePage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.profile_id !== "string" || !UUID.test(row.profile_id) || typeof row.title !== "string" || typeof row.slug !== "string") return null;
  if (typeof row.status !== "string" || !PAGE_STATUSES.includes(row.status) || !isDay(row.collecting_since)) return null;
  return {
    profileId: row.profile_id,
    title: row.title,
    slug: row.slug,
    status: row.status as PageStatus,
    everPublished: row.ever_published === true,
    collectingSince: row.collecting_since,
    firstEventDay: isDay(row.first_event_day) ? row.first_event_day : null,
    counts: parseCounts(row.counts),
  };
}

/** Reads the RPC's JSON defensively. Null means the answer is not something this build understands. */
export function parseWorkspaceReport(value: unknown): WorkspaceReport | null {
  const base = parseAnalyticsReport(value);
  if (!base) return null;
  const raw = value as Record<string, unknown>;
  const pages = (Array.isArray(raw.pages) ? raw.pages : []).flatMap((item) => {
    const page = parsePage(item);
    return page ? [page] : [];
  });
  return {
    ...base,
    // The consolidated view has no blocks, campaigns, devices or countries: those stay per page.
    blocks: [], utms: [], devices: [], countries: [],
    pages,
    pageCount: nonNegativeInteger(raw.page_count),
    pagesOmitted: nonNegativeInteger(raw.pages_omitted),
    pagesTruncated: raw.pages_truncated === true,
  };
}

// ---------------------------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------------------------

export type WorkspaceState =
  /** The migration, the signing secret or the function is not in place. */
  | "not_available"
  /** The workspace has no page at all. */
  | "no_pages"
  /** No page is on the air and none has ever had an event. */
  | "nothing_published"
  /** The whole period is before the workspace existed or before collection started. */
  | "before_collection"
  /** Pages are on the air, but no event has ever arrived. */
  | "no_data_yet"
  /** The workspace has had events, none of them in this period. */
  | "zero"
  | "data";

export function workspaceState(report: WorkspaceReport | null): WorkspaceState {
  if (!report || !report.configured) return "not_available";
  if (report.pageCount === 0) return "no_pages";
  const state = dashboardState({ report, everPublished: report.pages.some((page) => page.status === "published" || page.everPublished) });
  return state === "never_published" ? "nothing_published" : state;
}

function hasEvents(counts: EventCounts): boolean {
  return ANALYTICS_EVENT_TYPES.some((type) => (counts[type] ?? 0) > 0);
}

/**
 * The state of one page inside the workspace's period, by the same rule as the page's own
 * dashboard: the page's row is read as a one-page report.
 */
export function pageState(report: WorkspaceReport, page: WorkspacePage): DashboardState {
  return dashboardState({
    report: {
      ...report,
      collectingSince: page.collectingSince,
      firstEventDay: page.firstEventDay,
      days: hasEvents(page.counts) ? [{ day: report.from, counts: page.counts }] : [],
    },
    everPublished: page.status === "published" || page.everPublished,
  });
}

export interface PageRow {
  page: WorkspacePage;
  state: DashboardState;
  /** Null when the page has no numbers to show in this period ("no data" is not zero). */
  totals: Totals | null;
}

const COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/**
 * One row per listed page, the ones that brought more results first. Ties: more visits, then the
 * name, then the id, so the order is stable between reloads. Pages without numbers come last.
 */
export function pageRows(report: WorkspaceReport): PageRow[] {
  return report.pages
    .map((page): PageRow => {
      const state = pageState(report, page);
      return { page, state, totals: state === "data" || state === "zero" ? totalsFromCounts(page.counts) : null };
    })
    .sort((a, b) => Number(b.totals !== null) - Number(a.totals !== null)
      || (b.totals?.results ?? 0) - (a.totals?.results ?? 0)
      || (b.totals?.visits ?? 0) - (a.totals?.visits ?? 0)
      || COLLATOR.compare(a.page.title, b.page.title)
      || (a.page.profileId < b.page.profileId ? -1 : a.page.profileId > b.page.profileId ? 1 : 0));
}

/** How many listed pages have events in the period and how many do not (the mixed case). */
export function dataCoverage(rows: readonly PageRow[]): { withData: number; withoutData: number } {
  const withData = rows.filter((row) => row.state === "data").length;
  return { withData, withoutData: rows.length - withData };
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

const COLUMNS = [
  "pagina", "endereco", "situacao_da_pagina", "de", "ate", "fuso_horario", "situacao_dos_dados", "visitas_estimadas", "resultados",
  "resultados_a_cada_100_visitas", "cliques_em_links", "cliques_em_redes_sociais", "cliques_no_whatsapp", "copias_da_chave_pix",
  "cliques_no_link_de_pagamento", "envios_de_formulario", "videos_ou_musicas_carregados",
] as const;

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const PAGE_STATUS_LABELS: Record<PageStatus, string> = { draft: "rascunho", published: "publicada", archived: "arquivada" };

const DATA_STATE_LABELS: Record<DashboardState, string> = {
  data: "com dados",
  zero: "sem visitas nem cliques no período",
  no_data_yet: "sem dados ainda",
  before_collection: "período anterior ao início da contagem",
  never_published: "nunca publicada",
  not_available: "contagem não disponível",
};

function rate(value: number | null): string {
  return value === null ? "" : (Math.round(value * 1000) / 10).toFixed(1).replace(".", ",");
}

/**
 * CSV of the per-page totals of the period (ADR 0013). Aggregates only. The period and the
 * timezone are columns, so the file is self-describing; a page without numbers has empty cells,
 * not zeros. Cells use the lead export's escaping (quotes doubled, spreadsheet formulas neutralized).
 */
export function workspaceAnalyticsToCsv(rows: readonly PageRow[], report: Pick<WorkspaceReport, "from" | "to" | "timeZone">): string {
  const lines = rows.map(({ page, state, totals }) => {
    const number = (value: number | undefined) => (totals ? String(value ?? 0) : "");
    return [
      page.title, `/${page.slug}`, PAGE_STATUS_LABELS[page.status], report.from, report.to, report.timeZone, DATA_STATE_LABELS[state],
      number(totals?.visits), number(totals?.results), totals ? rate(totals.resultRate) : "",
      number(totals?.counts.link_click), number(totals?.counts.social_click), number(totals?.counts.whatsapp_click), number(totals?.counts.pix_copy),
      number(totals?.counts.pix_pay_click), number(totals?.counts.form_submit), number(totals?.counts.embed_load),
    ].map(csvCell).join(",");
  });
  return `${BYTE_ORDER_MARK}${[COLUMNS.join(","), ...lines].join("\r\n")}\r\n`;
}
