import type { Locale } from "@/lib/locale";
import { MailError, type MailAdapter } from "./adapter";
import type { RenderedMail } from "./templates";

/**
 * Draining the outbox (ADR 0021). Pure orchestration over two ports: the database's claim and
 * completion, and the provider. Each claimed message ends in exactly one completion:
 *
 *   sent      the provider accepted it
 *   retry     the provider did not answer or asked to slow down (the database backs off and gives
 *             up after five attempts)
 *   failed    the provider refused it, or it cannot be written
 *   skipped   the recipient has no confirmed address any more
 *
 * With mail off nothing is claimed, so no attempt is spent: messages wait and expire.
 */
export interface ClaimedMail {
  id: string;
  kind: string;
  workspaceId: string | null;
  payload: unknown;
  attempts: number;
  email: string | null;
  displayName: string | null;
  /** The recipient's language, read at claim time with the address (ADR 0022). */
  locale: Locale;
}

export type CompletionOutcome = "sent" | "retry" | "failed" | "skipped";

export interface OutboxPort {
  claim(limit: number): Promise<ClaimedMail[]>;
  complete(id: string, outcome: CompletionOutcome, error: string | null, providerMessageId: string | null): Promise<void>;
}

export interface DrainReport {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

export const EMPTY_DRAIN: DrainReport = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };

export async function drainOutbox(deps: {
  outbox: OutboxPort;
  adapter: MailAdapter | null;
  render: (mail: ClaimedMail) => RenderedMail | null;
  batchSize: number;
  maxBatches: number;
}): Promise<DrainReport> {
  const report = { ...EMPTY_DRAIN };
  if (!deps.adapter) return report;
  for (let batch = 0; batch < deps.maxBatches; batch += 1) {
    const claimed = await deps.outbox.claim(deps.batchSize);
    report.claimed += claimed.length;
    for (const mail of claimed) {
      if (!mail.email) {
        await deps.outbox.complete(mail.id, "skipped", "no_confirmed_address", null);
        report.skipped += 1;
        continue;
      }
      const rendered = deps.render(mail);
      if (!rendered) {
        await deps.outbox.complete(mail.id, "failed", "invalid_payload", null);
        report.failed += 1;
        continue;
      }
      try {
        const { id } = await deps.adapter.send({ to: mail.email, subject: rendered.subject, text: rendered.text, html: rendered.html, idempotencyKey: `lnk-mail-${mail.id}`, tag: rendered.tag });
        await deps.outbox.complete(mail.id, "sent", null, id);
        report.sent += 1;
      } catch (error) {
        const refused = error instanceof MailError && error.kind === "rejected";
        const code = error instanceof MailError ? `${error.kind}${error.providerCode ? `:${error.providerCode}` : ""}` : "unexpected";
        await deps.outbox.complete(mail.id, refused ? "failed" : "retry", code, null);
        if (refused) report.failed += 1;
        else report.retried += 1;
      }
    }
    if (claimed.length < deps.batchSize) break;
  }
  return report;
}

export type MailDrainResult = { kind: "done"; report: DrainReport } | { kind: "mail_off"; reason: string } | { kind: "not_configured" } | { kind: "not_deployed" };

export interface DrainLogEntry {
  level: "info" | "warn";
  event: "mail.drain" | "mail.off";
  fields: Record<string, string | number>;
}

/**
 * What the request that queued a message logs after trying to send it. Mail that is off, or a
 * server without the database secret, is a warning on every such request: otherwise a missing
 * variable or a deploy that predates it leaves no trace while messages wait and expire. A drain
 * that found nothing to send logs nothing. Reasons and counts only, never an address.
 */
export function drainLogEntry(source: string, result: MailDrainResult): DrainLogEntry | null {
  switch (result.kind) {
    case "done":
      if (result.report.claimed === 0) return null;
      return { level: result.report.failed + result.report.retried > 0 ? "warn" : "info", event: "mail.drain", fields: { source, ...result.report } };
    case "mail_off":
      return { level: "warn", event: "mail.off", fields: { source, reason: result.reason } };
    case "not_configured":
    case "not_deployed":
      return { level: "warn", event: "mail.off", fields: { source, reason: result.kind } };
  }
}
