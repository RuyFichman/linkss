"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";
import { eraseAccountForRequest } from "@/modules/privacy/erasure-server";

export async function reviewPrivacyRequestAction(formData: FormData): Promise<void> {
  if (!(await getCurrentUserId())) redirect("/entrar");
  const requestId = formData.get("requestId");
  const status = formData.get("status");
  const reason = formData.get("reason");
  const evidence = formData.get("evidence");
  if (typeof requestId !== "string" || typeof status !== "string" || typeof reason !== "string" || typeof evidence !== "string") notFound();
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("review_privacy_request", {
    p_request_id: requestId,
    p_status: status,
    p_reason_code: reason,
    p_evidence_reference: evidence.trim() || undefined,
  });
  if (error?.code === "42501" || error?.code === "P0002") notFound();
  if (error) redirect("/app/administracao/privacidade?erro=acao");
  revalidatePath("/app/administracao/privacidade");
}

/** The word the operator types to confirm an erasure. Not a secret: a brake against a stray click. */
const ERASURE_CONFIRMATION = "EXCLUIR";

/**
 * Runs an account deletion request (ADR 0018). The database refuses everyone who is not a platform
 * administrator and every request that is not in processing; this action only carries the form to
 * it and the outcome back. The log has the outcome and counts, never the account or its address.
 */
export async function eraseAccountAction(formData: FormData): Promise<void> {
  if (!(await getCurrentUserId())) redirect("/entrar");
  const requestId = formData.get("requestId");
  const evidence = formData.get("evidence");
  if (typeof requestId !== "string" || typeof evidence !== "string") notFound();
  if (formData.get("confirmation") !== ERASURE_CONFIRMATION) redirect("/app/administracao/privacidade?exclusao=confirmation");
  const startedAt = performance.now();
  const result = await eraseAccountForRequest(requestId, evidence);
  logEvent(result.outcome === "erased" ? "info" : result.outcome === "unavailable" ? "error" : "warn", "privacy.erasure", {
    correlationId: correlationIdFrom((await headers()).get(CORRELATION_HEADER)),
    outcome: result.outcome, pages: result.pages, hostnames: result.hostnames, workspaces: result.counts?.workspaces,
    durationMs: Math.round(performance.now() - startedAt),
  });
  if (result.outcome === "forbidden" || result.outcome === "not_found") notFound();
  revalidatePath("/app/administracao/privacidade");
  redirect(`/app/administracao/privacidade?exclusao=${result.outcome}`);
}
