import { ANALYTICS_EVENT_TYPES, INTERACTION_TYPES, isAnalyticsEventType, VALUE_ACTION_TYPES, type AnalyticsEventType } from "./contract";
import { addDays, daysBetween, daysInWindow, isDay } from "./dates";

/**
 * Dashboard view model (ADR 0011). Pure functions over the report that
 * public.get_profile_analytics() returns: which state to show, the funnel, the daily series and
 * the rankings. No copy and no formatting here; business rules stay out of the components.
 */
export type EventCounts = Partial<Record<AnalyticsEventType, number>>;

export interface AnalyticsReport {
  timeZone: string;
  /** Reporting day of the database clock when the report was read. */
  today: string;
  from: string;
  to: string;
  /** History depth of the workspace's plan (the `analytics_days` entitlement). */
  historyDays: number;
  /** First day this page could have data: the later of its creation and the start of collection. */
  collectingSince: string;
  /** False while the signing secret is missing in the database: nothing is being stored. */
  configured: boolean;
  /** First day with any event of this page, or null when there has never been one. */
  firstEventDay: string | null;
  /** Latest day the aggregation job closed, or null when it has never run. */
  lastFinalDay: string | null;
  /** Counts per day and type; days without events are absent. */
  days: Array<{ day: string; counts: EventCounts }>;
  blocks: Array<{ blockId: string; type: AnalyticsEventType; count: number }>;
  sources: KeyCount[];
  utms: KeyCount[];
  devices: KeyCount[];
  countries: KeyCount[];
}

export interface KeyCount {
  key: string;
  count: number;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function keyCounts(value: unknown): KeyCount[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): KeyCount[] => {
    const row = item as Record<string, unknown> | null;
    const total = count(row?.count);
    return row && typeof row.key === "string" && total !== null ? [{ key: row.key, count: total }] : [];
  });
}

/** Reads the RPC's JSON defensively. Null means the answer is not a report this build understands. */
export function parseAnalyticsReport(value: unknown): AnalyticsReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const historyDays = count(raw.history_days);
  if (typeof raw.timezone !== "string" || !isDay(raw.today) || !isDay(raw.from) || !isDay(raw.to) || !isDay(raw.collecting_since) || historyDays === null) return null;

  const byDay = new Map<string, EventCounts>();
  for (const item of Array.isArray(raw.days) ? raw.days : []) {
    const row = item as Record<string, unknown> | null;
    const total = count(row?.count);
    if (!row || !isDay(row.day) || !isAnalyticsEventType(row.event_type) || total === null) continue;
    const counts = byDay.get(row.day) ?? {};
    counts[row.event_type] = (counts[row.event_type] ?? 0) + total;
    byDay.set(row.day, counts);
  }
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : []).flatMap((item): AnalyticsReport["blocks"] => {
    const row = item as Record<string, unknown> | null;
    const total = count(row?.count);
    return row && typeof row.block_id === "string" && isAnalyticsEventType(row.event_type) && total !== null ? [{ blockId: row.block_id, type: row.event_type, count: total }] : [];
  });

  return {
    timeZone: raw.timezone,
    today: raw.today,
    from: raw.from,
    to: raw.to,
    historyDays,
    collectingSince: raw.collecting_since,
    configured: raw.configured === true,
    firstEventDay: isDay(raw.first_event_day) ? raw.first_event_day : null,
    lastFinalDay: isDay(raw.last_final_day) ? raw.last_final_day : null,
    days: [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, counts]) => ({ day, counts })),
    blocks,
    sources: keyCounts(raw.sources),
    utms: keyCounts(raw.utms),
    devices: keyCounts(raw.devices),
    countries: keyCounts(raw.countries),
  };
}

// ---------------------------------------------------------------------------------------------
// States: "no data" is never shown as "zero" (AC3)
// ---------------------------------------------------------------------------------------------

export type DashboardState =
  /** The migration, the signing secret or the function is not in place: nothing is collected. */
  | "not_available"
  /** The page has never been on the air, so nobody could have visited it. */
  | "never_published"
  /** The whole period is before the page existed or before collection started. */
  | "before_collection"
  /** Published and collecting, but no event has ever arrived. */
  | "no_data_yet"
  /** The page has had events, none of them in this period. */
  | "zero"
  | "data";

/** The job closes yesterday every night; two closed days behind means it missed a run. */
export const DELAY_TOLERANCE_DAYS = 2;

export interface DashboardInput {
  /** Null when the report could not be read as a deployed feature (see `not_available`). */
  report: AnalyticsReport | null;
  everPublished: boolean;
}

export function dashboardState({ report, everPublished }: DashboardInput): DashboardState {
  if (!report || !report.configured) return "not_available";
  if (report.firstEventDay === null) return everPublished ? (report.to < report.collectingSince ? "before_collection" : "no_data_yet") : "never_published";
  if (report.to < report.collectingSince) return "before_collection";
  return report.days.some(({ day }) => day >= report.from && day <= report.to) ? "data" : "zero";
}

/**
 * True when the nightly consolidation is behind. The numbers are still complete (unclosed days are
 * read from raw events), but the owner is told, because a job that stays down ends in lost data.
 */
export function aggregationIsDelayed(report: AnalyticsReport): boolean {
  const expected = addDays(report.today, -DELAY_TOLERANCE_DAYS);
  // Nothing to close yet: collection started too recently for a closed day to be due.
  if (report.collectingSince > expected) return false;
  return report.lastFinalDay === null || report.lastFinalDay < expected;
}

export type DayStatus = "before_collection" | "zero" | "data";

export interface DayRow {
  day: string;
  status: DayStatus;
  /** Today is still being counted. */
  partial: boolean;
  visits: number;
  interactions: number;
  results: number;
  counts: EventCounts;
}

function sum(counts: EventCounts, types: readonly AnalyticsEventType[]): number {
  return types.reduce((total, type) => total + (counts[type] ?? 0), 0);
}

/** One row per day of the window, oldest first, including the days without events. */
export function dailySeries(report: AnalyticsReport): DayRow[] {
  const byDay = new Map(report.days.map(({ day, counts }) => [day, counts]));
  return daysInWindow(report.from, report.to).map((day) => {
    const counts = byDay.get(day) ?? {};
    const hasData = ANALYTICS_EVENT_TYPES.some((type) => (counts[type] ?? 0) > 0);
    return {
      day,
      status: hasData ? "data" : day < report.collectingSince ? "before_collection" : "zero",
      partial: day === report.today,
      visits: counts.page_view ?? 0,
      interactions: sum(counts, INTERACTION_TYPES),
      results: sum(counts, VALUE_ACTION_TYPES),
      counts,
    };
  });
}

export interface Totals {
  visits: number;
  interactions: number;
  results: number;
  linkClicks: number;
  counts: EventCounts;
  /** Results per visit, 0..n (one visit can produce several results); null without visits. */
  resultRate: number | null;
  /** Interactions per visit; null without visits. */
  interactionRate: number | null;
}

/** Period totals. They are the sum of the daily rows by construction. */
export function periodTotals(rows: readonly DayRow[]): Totals {
  const counts: EventCounts = {};
  for (const row of rows) {
    for (const type of ANALYTICS_EVENT_TYPES) {
      const value = row.counts[type];
      if (value) counts[type] = (counts[type] ?? 0) + value;
    }
  }
  const visits = counts.page_view ?? 0;
  const interactions = sum(counts, INTERACTION_TYPES);
  const results = sum(counts, VALUE_ACTION_TYPES);
  return {
    visits, interactions, results, linkClicks: counts.link_click ?? 0, counts,
    resultRate: visits > 0 ? results / visits : null,
    interactionRate: visits > 0 ? interactions / visits : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------------------------

export interface KnownBlock {
  id: string;
  /** Position in the current draft, used to break ties. */
  position: number;
}

export interface BlockRankRow {
  blockId: string;
  /** Null when the block is no longer in the draft. */
  position: number | null;
  clicks: number;
  results: number;
  /** Most frequent event type of the block, to name a block that was removed. */
  mainType: AnalyticsEventType;
  /** Clicks per visit; null without visits. */
  clickRate: number | null;
}

/**
 * Blocks by clicks, most used first. Ties keep the order of the page (removed blocks last, then by
 * id), so the ranking is stable between reloads.
 */
export function blockRanking(report: AnalyticsReport, knownBlocks: readonly KnownBlock[], visits: number): BlockRankRow[] {
  const positions = new Map(knownBlocks.map((block) => [block.id, block.position]));
  const rows = new Map<string, { clicks: number; results: number; byType: EventCounts }>();
  for (const { blockId, type, count: total } of report.blocks) {
    if (!(INTERACTION_TYPES as readonly string[]).includes(type)) continue;
    const row = rows.get(blockId) ?? { clicks: 0, results: 0, byType: {} };
    row.clicks += total;
    if ((VALUE_ACTION_TYPES as readonly string[]).includes(type)) row.results += total;
    row.byType[type] = (row.byType[type] ?? 0) + total;
    rows.set(blockId, row);
  }
  return [...rows.entries()]
    .map(([blockId, row]): BlockRankRow => ({
      blockId,
      position: positions.get(blockId) ?? null,
      clicks: row.clicks,
      results: row.results,
      mainType: ANALYTICS_EVENT_TYPES.reduce((best, type) => ((row.byType[type] ?? 0) > (row.byType[best] ?? 0) ? type : best), "link_click" as AnalyticsEventType),
      clickRate: visits > 0 ? row.clicks / visits : null,
    }))
    .sort((a, b) => b.clicks - a.clicks
      || (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)
      || (a.blockId < b.blockId ? -1 : 1));
}

export interface ShareRow {
  key: string;
  count: number;
  /** Share of the listed total, 0..1; null when the total is zero. */
  share: number | null;
}

/** Rows by count, largest first, ties by key. `limit` keeps the list bounded; the rest is summed as "outros". */
export function shareRanking(rows: readonly KeyCount[], limit = 10): { rows: ShareRow[]; others: number; total: number } {
  const sorted = [...rows].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
  const total = sorted.reduce((accumulator, row) => accumulator + row.count, 0);
  const shown = sorted.slice(0, limit);
  return {
    rows: shown.map((row) => ({ ...row, share: total > 0 ? row.count / total : null })),
    others: sorted.slice(limit).reduce((accumulator, row) => accumulator + row.count, 0),
    total,
  };
}

/** UTM keys are stored as "source|medium|campaign"; none of the parts can contain "|". */
export function splitUtmKey(key: string): { source: string; medium: string; campaign: string } {
  const [source = "", medium = "", campaign = ""] = key.split("|");
  return { source, medium, campaign };
}

/** Days of the window that are before the page could have data, for the note next to the series. */
export function daysBeforeCollection(report: AnalyticsReport): number {
  if (report.from >= report.collectingSince) return 0;
  return Math.min(daysBetween(report.from, report.collectingSince), daysBetween(report.from, report.to) + 1);
}
