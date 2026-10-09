import type { PlanId } from "@/lib/product";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { isBillingInterval, isPlanId } from "./catalog";
import type { BillingErrorKind } from "./service";
import { SUBSCRIPTION_STATUSES, type SubscriptionRecord } from "./subscription";

/** Maps the SQLSTATE contract of the billing RPCs (ADR 0014) to domain errors. */
export function billingErrorFromDatabase(error: { code?: string | null; details?: string | null }): BillingErrorKind {
  if (isMissingSchemaError(error)) return "not_deployed";
  switch (error.code) {
    case "42501": return "forbidden";
    case "P0002":
    case "PGRST116": return "not_found";
    case "22023": return "invalid_plan";
    case "LK100": return "already_subscribed";
    case "LK101": return "rate_limited";
    case "LK103": return error.details === "none" ? "no_subscription" : error.details === "same" ? "same_plan" : "invalid_state";
    case "LK060": return error.details === "not_configured" ? "not_configured" : "unavailable";
    default: return "unavailable";
  }
}

export interface SubscriptionRow {
  plan_id: string;
  billing_interval: string;
  amount_cents: number;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  grace_until: string | null;
  held_plan_id: string | null;
  held_until: string | null;
  created_at: string;
}

function date(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A stored row as the state machine's record, or null when it holds something this version does not know. */
export function toSubscriptionRecord(row: SubscriptionRow): SubscriptionRecord | null {
  const status = SUBSCRIPTION_STATUSES.find((value) => value === row.status);
  if (!status || !isPlanId(row.plan_id) || !isBillingInterval(row.billing_interval)) return null;
  const heldPlanId = row.held_plan_id !== null && isPlanId(row.held_plan_id) ? row.held_plan_id : null;
  const heldUntil = heldPlanId ? date(row.held_until) : null;
  return {
    status, planId: row.plan_id, interval: row.billing_interval, currentPeriodEnd: date(row.current_period_end), cancelAtPeriodEnd: row.cancel_at_period_end,
    graceUntil: date(row.grace_until), heldPlanId: heldUntil ? heldPlanId : null, heldUntil,
  };
}

/** The subscription a workspace's screens talk about: the paying one, otherwise the most recent. */
export function pickCurrentSubscription<Row extends Pick<SubscriptionRow, "status" | "created_at">>(rows: readonly Row[]): Row | null {
  const live = rows.find((row) => row.status === "active" || row.status === "past_due");
  if (live) return live;
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

export interface InvoiceView {
  id: string;
  amountCents: number;
  status: "open" | "paid" | "void" | "uncollectible";
  issuedAt: string;
  paidAt: string | null;
  receiptUrl: string | null;
}

export interface WorkspaceBilling {
  /** False while the Sprint 8 migration is not applied: the screens then behave as before billing existed. */
  deployed: boolean;
  planId: PlanId;
  record: SubscriptionRecord | null;
  /** What the current subscription charges per interval, from the stored copy. */
  amountCents: number | null;
  invoices: InvoiceView[];
}

const INVOICE_STATUSES = ["open", "paid", "void", "uncollectible"] as const;

export function toInvoiceView(row: { id: string; amount_cents: number; status: string; issued_at: string; paid_at: string | null; receipt_url: string | null }): InvoiceView | null {
  const status = INVOICE_STATUSES.find((value) => value === row.status);
  if (!status) return null;
  // Rendered as a link: only ever an https address (the database checks it too).
  const receiptUrl = row.receipt_url && row.receipt_url.startsWith("https://") ? row.receipt_url : null;
  return { id: row.id, amountCents: row.amount_cents, status, issuedAt: row.issued_at, paidAt: row.paid_at, receiptUrl };
}
