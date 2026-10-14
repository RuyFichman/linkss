/**
 * Why an owner cancels (ADR 0014, addendum). Asked on the confirmation step, never required: the
 * cancellation goes through with or without an answer. The list is mirrored by the check of
 * `billing_cancellation_feedback.reason` and by `record_cancellation_feedback`, and by
 * `BILLING_COPY.cancelReason.options`: change them together.
 */
export const CANCELLATION_REASONS = ["too_expensive", "missing_feature", "not_using", "switching_tool", "technical_problems", "temporary", "other"] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const CANCELLATION_COMMENT_MAX_LENGTH = 500;

export interface CancellationFeedback {
  reason: CancellationReason;
  /** Free text the owner wrote, trimmed; null when empty. */
  comment: string | null;
}

export function isCancellationReason(value: unknown): value is CancellationReason {
  return typeof value === "string" && (CANCELLATION_REASONS as readonly string[]).includes(value);
}

/**
 * What the form sent, as feedback to store, or null when there is nothing to store. An answer is
 * a known reason; a comment without one is kept under `other` rather than thrown away. A comment
 * over the limit is cut, not refused: the form must never be the reason a cancellation fails.
 */
export function parseCancellationFeedback(reason: unknown, comment: unknown): CancellationFeedback | null {
  const text = typeof comment === "string" ? comment.trim().slice(0, CANCELLATION_COMMENT_MAX_LENGTH).trim() : "";
  if (isCancellationReason(reason)) return { reason, comment: text || null };
  return text ? { reason: "other", comment: text } : null;
}
