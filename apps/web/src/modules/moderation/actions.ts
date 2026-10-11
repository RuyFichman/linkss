"use server";

import { headers } from "next/headers";
import { MODERATION_COPY } from "@/content/pt-BR";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { isUuid } from "@/modules/identity/guard";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { allowRequest, RATE_LIMITS } from "@/lib/security/rate-limit";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { clientAddress, visitorHash } from "@/modules/leads/visitor-hash";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";
import { revalidatePublicPage } from "@/modules/publishing/cache";
import { appealOutcome, parseAppealMessage, type AppealOutcome } from "./appeals";
import { normalizeReportDetail, REPORT_REASONS, serializeReport, signReport, type ReportReason } from "./contract";

const SLUG = /^[a-z0-9][a-z0-9-]{2,29}$/;

export async function submitPublicReportAction(formData: FormData): Promise<void> {
  const slug = formData.get("pagina");
  const reason = formData.get("motivo");
  const detail = normalizeReportDetail(formData.get("detalhes"));
  const safeSlug = typeof slug === "string" && SLUG.test(slug) ? slug : "";
  if (!safeSlug || !REPORT_REASONS.includes(reason as ReportReason) || detail === null) {
    redirect("/denunciar?estado=erro");
  }
  if (formData.get("website")) redirect("/denunciar?estado=recebido");
  const secret = process.env.MODERATION_SIGNING_SECRET;
  if (!secret || secret.length < 32) redirect("/denunciar?estado=indisponivel");
  const requestHeaders = await headers();
  const address = clientAddress(requestHeaders.get("x-forwarded-for"), requestHeaders.get("x-real-ip"));
  // Over the per-instance limit: the neutral answer, and nothing is sent to the database.
  if (!allowRequest(RATE_LIMITS.moderation, address)) redirect("/denunciar?estado=recebido");
  const hash = visitorHash(address, process.env.VISITOR_HASH_SALT) ?? "direct";
  const text = serializeReport({ v: 1, slug: safeSlug, reason: reason as ReportReason, detail, hash, at: new Date().toISOString() });
  const { data, error } = await createPublicSupabaseClient().rpc("submit_moderation_report", {
    p_text: text,
    p_signature: signReport(text, secret),
  });
  if (error || data !== "received") redirect("/denunciar?estado=indisponivel");
  redirect("/denunciar?estado=recebido");
}

/**
 * An owner or admin contests the suspension of a page (ADR 0019). `workspaceId` and `profileId`
 * are bound by the screen but client-controlled: the database re-authorizes. The log carries the
 * outcome, never the text.
 */
export async function submitAppealAction(workspaceId: string, profileId: string, _previous: FormState, formData: FormData): Promise<FormState<"message">> {
  const copy = MODERATION_COPY.appeal;
  const raw = formData.get("message");
  const values = { message: typeof raw === "string" ? raw.slice(0, 1200) : "" };
  const done = async (outcome: AppealOutcome): Promise<void> => {
    logEvent(outcome === "sent" ? "info" : outcome === "unavailable" ? "error" : "warn", "moderation.appeal", { correlationId: correlationIdFrom((await headers()).get(CORRELATION_HEADER)), outcome });
  };
  if (!(await getCurrentUserId())) redirect("/entrar");
  if (!isUuid(workspaceId) || !isUuid(profileId)) notFound();
  const parsed = parseAppealMessage(raw);
  if (!parsed.ok) {
    await done("invalid");
    return { status: "error", fieldErrors: { message: copy.errors[parsed.problem] }, values };
  }
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("submit_moderation_appeal", { p_profile_id: profileId, p_message: parsed.message });
  if (error) {
    const outcome = appealOutcome(error.code, isMissingSchemaError(error));
    await done(outcome);
    return { status: "error", message: copy.errors[outcome], values };
  }
  await done("sent");
  revalidatePath(`/app/w/${workspaceId}/paginas/${profileId}/moderacao`);
  return { status: "success", message: copy.sent };
}

/** Platform administrator answers an appeal. Accepting puts the page back on the air. */
export async function decideAppealAction(formData: FormData): Promise<void> {
  if (!(await getCurrentUserId())) redirect("/entrar");
  const appealId = formData.get("appealId");
  const decision = formData.get("decision");
  const response = formData.get("response");
  if (typeof appealId !== "string" || typeof response !== "string" || (decision !== "accept" && decision !== "deny")) notFound();
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("decide_moderation_appeal", { p_appeal_id: appealId, p_accept: decision === "accept", p_response: response });
  if (error?.code === "42501" || error?.code === "P0002") notFound();
  if (error) redirect("/app/administracao/denuncias?erro=contestacao");
  const result = data as unknown as { slug?: string } | null;
  if (decision === "accept" && result?.slug && SLUG.test(result.slug)) revalidatePublicPage(result.slug);
  revalidatePath("/app/administracao/denuncias");
}

export async function reviewReportAction(formData: FormData): Promise<void> {
  if (!(await getCurrentUserId())) redirect("/entrar");
  const id = formData.get("reportId");
  const state = formData.get("state");
  const reason = formData.get("reason");
  if (typeof id !== "string" || typeof state !== "string" || typeof reason !== "string") notFound();
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("review_moderation_report", {
    p_report_id: id, p_status: state, p_reason: reason,
  });
  if (error?.code === "42501" || error?.code === "P0002") notFound();
  if (error) redirect("/app/administracao/denuncias?erro=analise");
  revalidatePath("/app/administracao/denuncias");
}

export async function setPageModerationAction(formData: FormData): Promise<void> {
  if (!(await getCurrentUserId())) redirect("/entrar");
  const profileId = formData.get("profileId");
  const reportId = formData.get("reportId");
  const reason = formData.get("reason");
  const suspend = formData.get("suspend");
  if (typeof profileId !== "string" || typeof reason !== "string" || (suspend !== "yes" && suspend !== "no")) notFound();
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("set_profile_moderation", {
    p_profile_id: profileId, p_report_id: typeof reportId === "string" && reportId ? reportId : undefined,
    p_suspend: suspend === "yes", p_reason: reason,
  });
  if (error?.code === "42501" || error?.code === "P0002") notFound();
  if (error) redirect("/app/administracao/denuncias?erro=acao");
  const result = data as unknown as { slug?: string } | null;
  if (result?.slug && SLUG.test(result.slug)) revalidatePublicPage(result.slug);
  revalidatePath("/app/administracao/denuncias");
}
