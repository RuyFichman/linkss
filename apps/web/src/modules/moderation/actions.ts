"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { clientAddress, visitorHash } from "@/modules/leads/visitor-hash";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";
import { revalidatePublicPage } from "@/modules/publishing/cache";
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
  const hash = visitorHash(clientAddress(requestHeaders.get("x-forwarded-for"), requestHeaders.get("x-real-ip")), process.env.VISITOR_HASH_SALT) ?? "direct";
  const text = serializeReport({ v: 1, slug: safeSlug, reason: reason as ReportReason, detail, hash, at: new Date().toISOString() });
  const { data, error } = await createPublicSupabaseClient().rpc("submit_moderation_report", {
    p_text: text,
    p_signature: signReport(text, secret),
  });
  if (error || data !== "received") redirect("/denunciar?estado=indisponivel");
  redirect("/denunciar?estado=recebido");
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
