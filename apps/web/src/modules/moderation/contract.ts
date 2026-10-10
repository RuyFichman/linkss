import { createHmac } from "node:crypto";

export const REPORT_REASONS = ["phishing", "impersonation", "illegal", "spam", "privacy", "other"] as const;
export type ReportReason = typeof REPORT_REASONS[number];
export const REPORT_SIGNING_SECRET_MIN_LENGTH = 32;

export interface ReportPayload {
  v: 1;
  slug: string;
  reason: ReportReason;
  detail: string;
  hash: string;
  at: string;
}

export function normalizeReportDetail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const detail = value.replace(/\s+/g, " ").trim();
  return detail.length === 0 || (detail.length >= 10 && detail.length <= 500) ? detail : null;
}

export function serializeReport(payload: ReportPayload): string {
  return JSON.stringify(payload);
}

export function signReport(text: string, secret: string): string {
  return createHmac("sha256", secret).update(text, "utf8").digest("hex");
}
