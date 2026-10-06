"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { REPORTS_COPY } from "@/content/pt-BR";
import { appUrl } from "@/lib/app-url";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { REPORT_LINKS_PER_PAGE, reportPath, type ReportLinkField } from "./links";
import { getReportLinksService } from "./server";
import type { ReportLinkCommandError } from "./service";

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Outcome only: never a token, a link or a path that contains one. */
async function logCommand(event: string, outcome: string): Promise<void> {
  const correlationId = correlationIdFrom((await headers()).get(CORRELATION_HEADER));
  logEvent(outcome === "ok" ? "info" : outcome === "unavailable" ? "error" : "warn", event, { correlationId, outcome });
}

function errorMessage(error: ReportLinkCommandError): string {
  return error === "too_many_active" ? REPORTS_COPY.form.limitReached(REPORT_LINKS_PER_PAGE) : REPORTS_COPY.errors[error];
}

export interface ReportLinkFormState extends FormState<ReportLinkField> {
  /** Present once, right after creation: the only time the link exists outside its creator's hands. */
  link?: { url: string; expiresAt: string };
}

/**
 * `profileId` and `historyDays` arrive bound from the page but are client-controlled: the service
 * re-authorizes the page against the caller's memberships, and the database checks the role, the
 * plan and the period again.
 */
export async function createReportLinkAction(profileId: string, historyDays: number, _previous: ReportLinkFormState, formData: FormData): Promise<ReportLinkFormState> {
  const values = { period: stringField(formData, "period"), expires: stringField(formData, "expires"), label: stringField(formData, "label") };
  const result = await (await getReportLinksService()).create(profileId, values, Number.isInteger(historyDays) ? historyDays : 0);
  await logCommand("reports.create_link", result.ok ? "ok" : result.error);
  if (!result.ok) {
    return {
      status: "error", message: errorMessage(result.error), values, code: result.error,
      ...(result.field ? { fieldErrors: { [result.field]: REPORTS_COPY.fieldErrors[result.field] } } : {}),
    };
  }
  refresh();
  return { status: "success", message: REPORTS_COPY.form.created, link: { url: appUrl(reportPath(result.value.token)), expiresAt: result.value.expiresAt } };
}

export async function revokeReportLinkAction(linkId: string): Promise<FormState> {
  const result = await (await getReportLinksService()).revoke(linkId);
  await logCommand("reports.revoke_link", result.ok ? "ok" : result.error);
  if (!result.ok) return { status: "error", message: errorMessage(result.error), code: result.error };
  refresh();
  return { status: "success", message: REPORTS_COPY.revoke.done };
}
