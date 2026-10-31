import "server-only";
import { DEFAULT_LOCALE, isLocale } from "@/lib/locale";
import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { appUrl, publicAddressLabel } from "@/lib/app-url";
import type { Database } from "@/lib/database.types";
import { logEvent } from "@/lib/observability/logger";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { resolveBillingMode } from "@/modules/billing/mode";
import { resolveMailConfig } from "./config";
import { drainLogEntry, drainOutbox, EMPTY_DRAIN, type MailDrainResult, type OutboxPort } from "./outbox";
import { createResendAdapter } from "./resend-adapter";
import { renderMail } from "./templates";

/**
 * Wiring of the outbox (ADR 0021). The service role claims and completes messages; nothing here
 * runs with a person's session. Two callers: `scheduleMailDrain`, after the response of the
 * request that caused a message (a form contact, a moderation decision, a billing change), and
 * the daily job. Neither waits on the provider while a person waits.
 */
function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  return createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type { MailDrainResult } from "./outbox";

function outboxPort(client: NonNullable<ReturnType<typeof serviceClient>>): OutboxPort {
  return {
    async claim(limit) {
      const { data, error } = await client.rpc("claim_mail_outbox", { p_limit: limit });
      if (error) throw Object.assign(new Error(`Mail claim failed: ${error.code}`), { code: error.code });
      return (data ?? []).map((row) => ({ id: row.id, kind: row.kind, workspaceId: row.workspace_id, payload: row.payload, attempts: row.attempts, email: row.email, displayName: row.display_name, locale: isLocale(row.locale) ? row.locale : DEFAULT_LOCALE }));
    },
    async complete(id, outcome, error, providerMessageId) {
      const { error: failure } = await client.rpc("complete_mail_outbox", { p_id: id, p_outcome: outcome, ...(error ? { p_error: error } : {}), ...(providerMessageId ? { p_provider_message_id: providerMessageId } : {}) });
      // The lease brings an uncompleted message back in ten minutes; the idempotency key stops a
      // second copy for a day. Logged, never thrown, so one message cannot stop the batch.
      if (failure) logEvent("error", "mail.complete_failed", { errorCode: failure.code });
    },
  };
}

/** Sends what is due now. Never throws. */
export async function drainMailNow(options: { batchSize?: number; maxBatches?: number } = {}): Promise<MailDrainResult> {
  const config = resolveMailConfig();
  if (config.mode === "off") return { kind: "mail_off", reason: config.reason };
  const client = serviceClient();
  if (!client) return { kind: "not_configured" };
  const adapter = createResendAdapter({ apiKey: config.apiKey, from: config.from, replyTo: config.replyTo, apiBaseUrl: config.apiBaseUrl });
  const billingIsTest = resolveBillingMode().mode === "sandbox";
  try {
    const report = await drainOutbox({
      outbox: outboxPort(client),
      adapter,
      render: (mail) => renderMail(mail.kind, mail.workspaceId, mail.payload, {
        appUrl, publicAddress: publicAddressLabel, recipientName: mail.displayName, replyReachesSomeone: config.replyTo !== null, billingIsTest, locale: mail.locale,
      }),
      batchSize: options.batchSize ?? 20,
      maxBatches: options.maxBatches ?? 1,
    });
    return { kind: "done", report };
  } catch (error) {
    if (isMissingSchemaError({ code: (error as { code?: string }).code ?? null })) return { kind: "not_deployed" };
    logEvent("error", "mail.drain_failed", {});
    return { kind: "done", report: EMPTY_DRAIN };
  }
}

/**
 * After the current response, send what the request just put in the outbox. Only from a Server
 * Action or a Route Handler. A failure here is a log line: the job of the next day sends it.
 * Mail that is off is a `mail.off` warning here too (`drainLogEntry`).
 */
export function scheduleMailDrain(source: string): void {
  try {
    after(async () => {
      const entry = drainLogEntry(source, await drainMailNow());
      if (entry) logEvent(entry.level, entry.event, entry.fields);
    });
  } catch {
    // Outside a request (a unit test, a script): the daily job sends it.
  }
}

export type MailMaintenanceResult = { kind: "done"; maintenance: { reminders: number; expired: number; purged: number; pending: number }; drain: MailDrainResult } | { kind: "not_configured" } | { kind: "not_deployed" };

/** The daily job: renewal reminders, expiry, purge, then a larger drain. */
export async function runMailMaintenance(): Promise<MailMaintenanceResult> {
  const client = serviceClient();
  if (!client) return { kind: "not_configured" };
  const { data, error } = await client.rpc("run_mail_maintenance");
  if (error) {
    if (isMissingSchemaError(error)) return { kind: "not_deployed" };
    throw new Error(`Mail maintenance failed: ${error.code}`);
  }
  const row = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);
  const drain = await drainMailNow({ batchSize: 20, maxBatches: 10 });
  return { kind: "done", maintenance: { reminders: count(row.reminders), expired: count(row.expired), purged: count(row.purged), pending: count(row.pending) }, drain };
}
