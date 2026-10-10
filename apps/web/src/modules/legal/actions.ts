"use server";

import { redirect } from "next/navigation";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";
import { currentLegalDocuments } from "./server";

export async function acceptLegalAction(formData: FormData): Promise<void> {
  if (!(await getCurrentUserId())) redirect("/entrar?next=/aceite");
  if (formData.get("agree") !== "yes") redirect("/aceite?erro=aceite");
  const documents = await currentLegalDocuments();
  const terms = documents.find((document) => document.kind === "terms");
  const privacy = documents.find((document) => document.kind === "privacy");
  if (!terms || !privacy) redirect("/aceite?erro=indisponivel");
  const expectedTerms = formData.get("terms");
  const expectedPrivacy = formData.get("privacy");
  if (expectedTerms !== terms.id || expectedPrivacy !== privacy.id) redirect("/aceite?erro=alterado");
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("accept_current_legal", {
    p_terms_id: terms.id,
    p_terms_hash: terms.sha256,
    p_privacy_id: privacy.id,
    p_privacy_hash: privacy.sha256,
  });
  if (error) redirect("/aceite?erro=alterado");
  redirect("/app");
}
