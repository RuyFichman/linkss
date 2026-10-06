import { isAnalyticsEventType, type AnalyticsEventType } from "@/modules/analytics/contract";
import {
  blockRanking, dailySeries, dashboardState, parseAnalyticsReport, periodTotals, shareRanking,
  type AnalyticsReport, type DashboardState, type DayRow, type ShareRow, type Totals,
} from "@/modules/analytics/dashboard";
import { daysBetween } from "@/modules/analytics/dates";

/**
 * The report a client reads at /r/<token> (ADR 0013). Pure functions over what
 * public.get_shared_report() returns. The numbers come from the same functions as the members'
 * dashboard, and the view model is built field by field from the closed list below: anything else
 * in the answer is ignored and never reaches the page.
 */

/** Every top-level field of an "ok" answer. pgTAP pins the same list on the database side. */
export const SHARED_REPORT_FIELDS = [
  "blocks", "collecting_since", "configured", "days", "ever_published", "expires_at", "first_event_day", "from", "last_final_day",
  "page_slug", "page_title", "show_badge", "sources", "status", "timezone", "to", "today", "workspace_name",
] as const;
export const SHARED_REPORT_BLOCK_FIELDS = ["block_type", "count", "event_type", "position", "ref", "title"] as const;

export interface SharedReportBlock {
  /** Ordinal that groups the rows of one block. Not an identifier of anything. */
  ref: number;
  /** Position on the published page, or null for a block that is no longer on it. */
  position: number | null;
  blockType: string | null;
  /** Text the visitor sees on the block, or null. */
  title: string | null;
  eventType: AnalyticsEventType;
  count: number;
}

export interface SharedReport {
  workspaceName: string;
  pageTitle: string;
  /** Public address of the page, only while it is on the air. */
  pageSlug: string | null;
  expiresAt: string;
  everPublished: boolean;
  showBadge: boolean;
  analytics: AnalyticsReport;
  blocks: SharedReportBlock[];
}

function text(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.slice(0, maxLength) : null;
}

function parseBlock(value: unknown): SharedReportBlock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.ref !== "number" || !Number.isInteger(row.ref) || row.ref < 1) return null;
  if (!isAnalyticsEventType(row.event_type) || typeof row.count !== "number" || !Number.isInteger(row.count) || row.count < 0) return null;
  return {
    ref: row.ref,
    position: typeof row.position === "number" && Number.isInteger(row.position) && row.position >= 1 ? row.position : null,
    blockType: text(row.block_type, 20),
    title: text(row.title, 120),
    eventType: row.event_type,
    count: row.count,
  };
}

/**
 * Null for everything that is not a report this build can show: "unavailable", a malformed answer,
 * a missing field. The caller renders the one generic state for all of them.
 */
export function parseSharedReport(value: unknown): SharedReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "ok") return null;
  const workspaceName = text(raw.workspace_name, 120);
  const pageTitle = text(raw.page_title, 120);
  if (!workspaceName || !pageTitle || typeof raw.expires_at !== "string" || Number.isNaN(Date.parse(raw.expires_at))) return null;
  // The shared answer has no history depth; the window it returns is already the one to show.
  const analytics = parseAnalyticsReport({
    timezone: raw.timezone, today: raw.today, from: raw.from, to: raw.to, configured: raw.configured, collecting_since: raw.collecting_since,
    first_event_day: raw.first_event_day, last_final_day: raw.last_final_day, days: raw.days, sources: raw.sources, history_days: 0,
  });
  if (!analytics) return null;
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : []).flatMap((item) => {
    const block = parseBlock(item);
    return block ? [block] : [];
  });
  return {
    workspaceName, pageTitle,
    pageSlug: typeof raw.page_slug === "string" && /^[a-z0-9-]{1,64}$/.test(raw.page_slug) ? raw.page_slug : null,
    expiresAt: raw.expires_at,
    everPublished: raw.ever_published === true,
    showBadge: raw.show_badge === true,
    analytics: { ...analytics, historyDays: daysBetween(analytics.from, analytics.to) + 1 },
    blocks,
  };
}

export interface SharedBlockRow {
  ref: number;
  title: string | null;
  blockType: string | null;
  mainType: AnalyticsEventType;
  clicks: number;
  results: number;
  /** Clicks per visit; null without visits. */
  clickRate: number | null;
}

export interface SharedReportView {
  state: DashboardState;
  /** Number of reporting days the report covers. */
  periodDays: number;
  rows: DayRow[];
  totals: Totals;
  sources: { rows: ShareRow[]; others: number; total: number };
  blocks: SharedBlockRow[];
}

const BLOCK_ROWS = 10;
const SOURCE_ROWS = 8;

/** Everything the page shows, computed with the dashboard's own functions. */
export function sharedReportView(report: SharedReport): SharedReportView {
  const { analytics } = report;
  const rows = dailySeries(analytics);
  const totals = periodTotals(rows);
  const byRef = new Map<number, SharedReportBlock>();
  for (const block of report.blocks) if (!byRef.has(block.ref)) byRef.set(block.ref, block);
  const ranking = blockRanking(
    { ...analytics, blocks: report.blocks.map((block) => ({ blockId: String(block.ref), type: block.eventType, count: block.count })) },
    [...byRef.values()].flatMap((block) => (block.position === null ? [] : [{ id: String(block.ref), position: block.position }])),
    totals.visits,
  );
  return {
    state: dashboardState({ report: analytics, everPublished: report.everPublished }),
    periodDays: daysBetween(analytics.from, analytics.to) + 1,
    rows,
    totals,
    sources: shareRanking(analytics.sources, SOURCE_ROWS),
    blocks: ranking.slice(0, BLOCK_ROWS).map((row) => {
      const block = byRef.get(Number(row.blockId));
      return { ref: Number(row.blockId), title: block?.title ?? null, blockType: block?.blockType ?? null, mainType: row.mainType, clicks: row.clicks, results: row.results, clickRate: row.clickRate };
    }),
  };
}
