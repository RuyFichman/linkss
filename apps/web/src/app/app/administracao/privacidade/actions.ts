"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";

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
