"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";

export async function requestAccountDeletionAction(): Promise<void> {
  if (!(await getCurrentUserId())) redirect("/entrar?next=/app/conta/dados");
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("request_account_deletion");
  if (error) redirect("/app/conta/dados?erro=indisponivel");
  revalidatePath("/app/conta/dados");
}

export async function requestDataAccessAction(): Promise<void> {
  if (!(await getCurrentUserId())) redirect("/entrar?next=/app/conta/dados");
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("request_data_access");
  if (error) redirect("/app/conta/dados?erro=indisponivel");
  revalidatePath("/app/conta/dados");
}
