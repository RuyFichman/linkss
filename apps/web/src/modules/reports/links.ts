import { isMissingSchemaError } from "@/lib/supabase/missing-schema";

/**
 * Report links (ADR 0013): the rules the application shares with the database. The database is the
 * authority (public.create_report_link and the report_links checks); these mirrors validate at the
 * boundary and drive the screen.
 */

/** Rolling windows a link may show, in reporting days ending on the last completed day. */
export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
/** UX-009: a month, the usual cadence of an agency's account of its work. */
export const DEFAULT_REPORT_PERIOD: ReportPeriod = 30;

/** How long a link may live, in days. Mirror of private.report_link_max_days(). */
export const REPORT_EXPIRY_OPTIONS = [7, 30, 90] as const;
export type ReportExpiry = (typeof REPORT_EXPIRY_OPTIONS)[number];
export const DEFAULT_REPORT_EXPIRY: ReportExpiry = 30;
export const REPORT_LINK_MAX_EXPIRY_DAYS = 90;

export const REPORT_LABEL_MAX_LENGTH = 80;
/** Mirror of the limits in public.create_report_link, for the copy only. */
export const REPORT_LINKS_PER_PAGE = 5;

/** 32 random bytes in base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export function isReportToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export const REPORT_PATH_PREFIX = "/r/";
export function reportPath(token: string): string {
  return `${REPORT_PATH_PREFIX}${token}`;
}

/** Periods the plan's history depth covers. A link never promises more days than the plan shows. */
export function availableReportPeriods(historyDays: number): ReportPeriod[] {
  return REPORT_PERIODS.filter((period) => period <= historyDays);
}

/** Mirror of the normalization in public.create_report_link: trim, collapse whitespace, empty is none. */
export function normalizeReportLabel(value: string): string | null {
  const label = value.replace(/\s+/g, " ").trim();
  return label === "" ? null : label;
}

export interface ReportLinkInput {
  periodDays: ReportPeriod;
  expiresInDays: ReportExpiry;
  label: string | null;
}

export type ReportLinkField = "period" | "expires" | "label";
export type ReportLinkInputResult = { ok: true; value: ReportLinkInput } | { ok: false; field: ReportLinkField };

/** Validates what the form sent. `historyDays` is the workspace's `analytics_days` entitlement. */
export function parseReportLinkInput(raw: { period: unknown; expires: unknown; label: unknown }, historyDays: number): ReportLinkInputResult {
  const period = REPORT_PERIODS.find((option) => String(option) === raw.period);
  if (period === undefined || period > historyDays) return { ok: false, field: "period" };
  const expires = REPORT_EXPIRY_OPTIONS.find((option) => String(option) === raw.expires);
  if (expires === undefined) return { ok: false, field: "expires" };
  const label = normalizeReportLabel(typeof raw.label === "string" ? raw.label : "");
  // Control characters have no place in a one-line note.
  if (label !== null && (label.length > REPORT_LABEL_MAX_LENGTH || /\p{Cc}/u.test(label))) return { ok: false, field: "label" };
  return { ok: true, value: { periodDays: period, expiresInDays: expires, label } };
}

export interface ReportLinkSummary {
  id: string;
  profileId: string;
  periodDays: number;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export type ReportLinkStatus = "active" | "expired" | "revoked";

/** Display status of a stored link at `now`. Revocation wins over the clock. */
export function reportLinkStatus(link: Pick<ReportLinkSummary, "expiresAt" | "revokedAt">, now: Date): ReportLinkStatus {
  if (link.revokedAt) return "revoked";
  const expires = Date.parse(link.expiresAt);
  return Number.isFinite(expires) && expires > now.getTime() ? "active" : "expired";
}

/** Active links first (the one that ends soonest on top), then the finished ones, newest first. */
export function sortReportLinks(links: readonly ReportLinkSummary[], now: Date): Array<ReportLinkSummary & { status: ReportLinkStatus }> {
  return links
    .map((link) => ({ ...link, status: reportLinkStatus(link, now) }))
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active")
      || (a.status === "active" ? Date.parse(a.expiresAt) - Date.parse(b.expiresAt) : Date.parse(b.createdAt) - Date.parse(a.createdAt))
      || (a.id < b.id ? -1 : 1));
}

export type ReportLinkErrorKind =
  | "invalid"
  | "not_in_plan"
  | "too_many_active"
  | "rate_limited"
  | "forbidden"
  | "not_found"
  | "not_deployed"
  | "unavailable";

/** Maps the SQLSTATE contract of ADR 0013 to one outcome per failure. */
export function reportLinkErrorFromDatabase(error: { code?: string | null }): ReportLinkErrorKind {
  if (isMissingSchemaError(error)) return "not_deployed";
  switch (error.code) {
    case "22023": return "invalid";
    case "LK010": return "not_in_plan";
    case "LK091": return "too_many_active";
    case "LK092": return "rate_limited";
    case "42501": return "forbidden";
    case "P0002":
    case "PGRST116": return "not_found";
    default: return "unavailable";
  }
}
