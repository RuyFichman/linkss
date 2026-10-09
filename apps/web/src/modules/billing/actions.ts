"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BILLING_COPY } from "@/content/pt-BR";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { revalidatePublicPage } from "@/modules/publishing/cache";
import { getBillingService } from "./server";
import { billingHomePath } from "./service";
import type { BillingErrorKind } from "./service";

/** Outcome only: never a provider id, an address of a checkout or anything about the payment. */
async function logCommand(event: string, outcome: string): Promise<void> {
  const correlationId = correlationIdFrom((await headers()).get(CORRELATION_HEADER));
  const level = outcome === "ok" ? "info" : outcome === "unavailable" || outcome === "provider_unavailable" || outcome === "provider_rejected" ? "error" : "warn";
  logEvent(level, event, { correlationId, outcome });
}

function failure(error: BillingErrorKind): FormState {
  return { status: "error", message: BILLING_COPY.errors[error], code: error };
}

/**
 * After a change the person goes back to the plan screen, which says what happened and shows the
 * new state. Staying on the confirmation would re-render it for a state it no longer applies to.
 */
function done(workspaceId: string, notice: "cancelada" | "mantida" | "alterada" | "agendada"): never {
  redirect(`${billingHomePath(workspaceId)}?aviso=${notice}`);
}

/** A plan change reaches pages that are already published: their cached copies are dropped. */
function revalidatePages(slugs: readonly string[]): void {
  for (const slug of slugs) revalidatePublicPage(slug);
}

/**
 * Opens the provider's checkout. `workspaceId`, `planId` and `interval` arrive bound from the page
 * but are client-controlled: the service re-checks the owner role, validates the plan and takes the
 * amount from the catalogue; the database checks the role again. On success the browser leaves for
 * the provider's page; nothing is granted here.
 */
export async function startCheckoutAction(workspaceId: string, planId: string, interval: string): Promise<FormState> {
  const result = await (await getBillingService()).startCheckout(workspaceId, planId, interval);
  await logCommand("billing.checkout", result.ok ? "ok" : result.error);
  if (!result.ok) return failure(result.error);
  redirect(result.value.url);
}

export async function cancelSubscriptionAction(workspaceId: string): Promise<FormState> {
  const result = await (await getBillingService()).cancel(workspaceId);
  await logCommand("billing.cancel", result.ok ? "ok" : result.error);
  if (!result.ok) return failure(result.error);
  revalidatePages(result.value.slugs);
  done(workspaceId, "cancelada");
}

export async function resumeSubscriptionAction(workspaceId: string): Promise<FormState> {
  const result = await (await getBillingService()).resume(workspaceId);
  await logCommand("billing.resume", result.ok ? "ok" : result.error);
  if (!result.ok) return failure(result.error);
  revalidatePages(result.value.slugs);
  done(workspaceId, "mantida");
}

export async function changePlanAction(workspaceId: string, planId: string): Promise<FormState> {
  const result = await (await getBillingService()).changePlan(workspaceId, planId);
  await logCommand("billing.change_plan", result.ok ? "ok" : result.error);
  if (!result.ok) return failure(result.error);
  revalidatePages(result.value.slugs);
  done(workspaceId, result.value.effective === "now" ? "alterada" : "agendada");
}

/** Sends the owner to the provider's own page for the card and the receipts. */
export async function openSelfServiceAction(workspaceId: string): Promise<FormState> {
  const result = await (await getBillingService()).openSelfService(workspaceId);
  await logCommand("billing.self_service", result.ok ? "ok" : result.error);
  if (!result.ok) return failure(result.error);
  redirect(result.value.url);
}
