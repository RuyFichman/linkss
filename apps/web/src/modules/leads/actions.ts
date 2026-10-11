"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { LEADS_COPY } from "@/content/pt-BR";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { allowRequest, RATE_LIMITS } from "@/lib/security/rate-limit";
import { FORM_FIELDS, type FormField } from "@/modules/blocks/form";
import { getLeadsService } from "./server";
import { createLeadSubmissionService, type LeadSubmitStatus } from "./service";
import type { LeadFieldProblems } from "./submission";
import { createSupabaseLeadSubmissionRepository } from "./supabase-repository";
import { clientAddress, visitorHash } from "./visitor-hash";

/** State of the public form (useActionState). `values` keeps what the visitor typed after an error. */
export interface LeadFormState {
  status: "idle" | LeadSubmitStatus;
  problems?: LeadFieldProblems;
  values?: Partial<Record<FormField, string>>;
  /** Whether the consent box was checked, so a field error does not undo the person's choice. */
  consent?: boolean;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Visitor submits a form block of a published page. Works as a plain HTML form post (no client
 * JavaScript needed). `slug` and `blockId` are bound by the page but are client-controlled: the
 * database validates them against the live publication. Logs carry the outcome only, never the
 * values typed.
 */
export async function submitLeadAction(slug: string, blockId: string, _previous: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const startedAt = performance.now();
  const requestHeaders = await headers();
  const address = clientAddress(requestHeaders.get("x-forwarded-for"), requestHeaders.get("x-real-ip"));
  const hash = visitorHash(address, process.env.VISITOR_HASH_SALT);
  const values = Object.fromEntries(FORM_FIELDS.map((field) => [field, text(formData, field)])) as Record<FormField, string>;
  const service = createLeadSubmissionService(createSupabaseLeadSubmissionRepository(), { clientHash: () => hash });
  const consent = formData.get("consent") === "yes";
  // Per-instance limit across pages; the per-page and per-visitor limits are in the database.
  if (!allowRequest(RATE_LIMITS.lead, address)) {
    logEvent("warn", "lead.submit", { correlationId: correlationIdFrom(requestHeaders.get(CORRELATION_HEADER)), outcome: "rate_limited", hashed: hash !== null, durationMs: Math.round(performance.now() - startedAt) });
    return { status: "rate_limited", values, consent };
  }
  const result = await service.submit(slug, blockId, { values, consent, honeypot: text(formData, "website") });

  logEvent(result.status === "unavailable" ? "error" : result.status === "ok" ? "info" : "warn", "lead.submit", {
    correlationId: correlationIdFrom(requestHeaders.get(CORRELATION_HEADER)),
    outcome: result.status,
    hashed: hash !== null,
    durationMs: Math.round(performance.now() - startedAt),
  });
  if (result.status === "ok") return { status: "ok" };
  return { status: result.status, problems: result.problems, values, consent };
}

/** Owner deletes one lead. `profileId` and `leadId` are client-controlled: the service re-authorizes. */
export async function deleteLeadAction(profileId: string, leadId: string): Promise<FormState> {
  const result = await (await getLeadsService()).remove(profileId, leadId);
  const correlationId = correlationIdFrom((await headers()).get(CORRELATION_HEADER));
  logEvent(result.ok ? "info" : result.error === "unavailable" ? "error" : "warn", "lead.delete", { correlationId, outcome: result.ok ? "ok" : result.error });
  if (!result.ok) {
    const message = result.error === "forbidden" ? LEADS_COPY.errors.forbidden : result.error === "not_found" ? LEADS_COPY.errors.notFound : LEADS_COPY.errors.unavailable;
    return { status: "error", message, code: result.error };
  }
  refresh();
  return { status: "success", message: LEADS_COPY.deleted };
}
