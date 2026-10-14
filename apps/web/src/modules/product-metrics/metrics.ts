import { isPlanId } from "@/modules/billing/catalog";
import { isCancellationReason, type CancellationReason } from "@/modules/billing/cancellation";
import type { PlanId } from "@/lib/product";

/**
 * Product funnel and activation cohorts (ADR 0020). `public.get_product_metrics` counts, per week
 * of sign-up, how many accounts reached each step; this module reads that answer and turns counts
 * into rates. Internal product analytics: platform administrators only, counts only, computed from
 * records the product already keeps. Nothing here is customer analytics (ADR 0011).
 */
export const FUNNEL_STEPS = ["signedUp", "confirmed", "createdPage", "published", "visited", "valueAction", "paid"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface FunnelCounts extends Record<FunnelStep, number> {
  /** Published within 24 hours of signing up (a subset of `published`). */
  published24h: number;
  /** Median minutes from sign-up to the first publication, among accounts that published. */
  medianMinutesToPublish: number | null;
}

export interface Cohort extends FunnelCounts {
  /** Monday of the week the accounts were created, in the reporting timezone (YYYY-MM-DD). */
  weekStart: string;
}

export interface ProductMetrics {
  generatedAt: string;
  timezone: string;
  weeks: number;
  totals: FunnelCounts;
  /** Most recent week first. */
  cohorts: Cohort[];
  cancellationReasons: { reason: CancellationReason; count: number }[];
  cancellationComments: { reason: CancellationReason; comment: string; planId: PlanId | null; createdAt: string }[];
}

/** Sprint 10 gate (PLANO_DE_EXECUCAO.md): activation of at least 60% among the invited. */
export const ACTIVATION_GATE_PERCENT = 60;
/** Sprint 10 acceptance criterion: median time to the first publication under 10 minutes. */
export const PUBLISH_MEDIAN_TARGET_MINUTES = 10;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function counts(value: unknown): FunnelCounts {
  const row = record(value) ?? {};
  const median = row.medianMinutesToPublish;
  return {
    signedUp: count(row.signedUp), confirmed: count(row.confirmed), createdPage: count(row.createdPage), published: count(row.published),
    published24h: count(row.published24h), visited: count(row.visited), valueAction: count(row.valueAction), paid: count(row.paid),
    medianMinutesToPublish: typeof median === "number" && Number.isFinite(median) && median >= 0 ? median : null,
  };
}

/** Reads the database answer; `null` when it is not the expected shape (shown as unavailable, never as zeros). */
export function parseProductMetrics(data: unknown): ProductMetrics | null {
  const row = record(data);
  if (!row || typeof row.generatedAt !== "string" || Number.isNaN(Date.parse(row.generatedAt)) || !record(row.totals) || !Array.isArray(row.cohorts)) return null;
  const cohorts = row.cohorts.flatMap((item): Cohort[] => {
    const cohort = record(item);
    return cohort && typeof cohort.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cohort.weekStart) ? [{ weekStart: cohort.weekStart, ...counts(cohort) }] : [];
  });
  const reasons = (Array.isArray(row.cancellationReasons) ? row.cancellationReasons : []).flatMap((item) => {
    const entry = record(item);
    return entry && isCancellationReason(entry.reason) && count(entry.count) > 0 ? [{ reason: entry.reason, count: count(entry.count) }] : [];
  });
  const comments = (Array.isArray(row.cancellationComments) ? row.cancellationComments : []).flatMap((item) => {
    const entry = record(item);
    if (!entry || !isCancellationReason(entry.reason) || typeof entry.comment !== "string" || entry.comment.length === 0 || typeof entry.createdAt !== "string") return [];
    return [{ reason: entry.reason, comment: entry.comment, planId: isPlanId(entry.planId) ? entry.planId : null, createdAt: entry.createdAt }];
  });
  return {
    generatedAt: row.generatedAt,
    timezone: typeof row.timezone === "string" ? row.timezone : "America/Sao_Paulo",
    weeks: count(row.weeks) || cohorts.length,
    totals: counts(row.totals), cohorts, cancellationReasons: reasons, cancellationComments: comments,
  };
}

/** Whole percent of `part` in `whole`; `null` when there is nothing to divide by (shown as "no data", not as 0%). */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export interface FunnelRow {
  step: FunnelStep;
  count: number;
  /** Of the accounts created. */
  ofSignedUp: number | null;
  /** Of the accounts that reached the step before. */
  ofPrevious: number | null;
}

export function funnelRows(totals: FunnelCounts): FunnelRow[] {
  return FUNNEL_STEPS.map((step, index) => {
    const previous = index === 0 ? null : FUNNEL_STEPS[index - 1];
    return { step, count: totals[step], ofSignedUp: rate(totals[step], totals.signedUp), ofPrevious: previous ? rate(totals[step], totals[previous]) : null };
  });
}

/**
 * Activation: the share of accounts created that published a page. `meetsGate` is `null` while no
 * account exists, so an empty pilot is never reported as a failed (or passed) gate.
 */
export function activation(totals: FunnelCounts): { percent: number | null; meetsGate: boolean | null; within24hPercent: number | null } {
  const percent = rate(totals.published, totals.signedUp);
  return { percent, meetsGate: percent === null ? null : percent >= ACTIVATION_GATE_PERCENT, within24hPercent: rate(totals.published24h, totals.signedUp) };
}
