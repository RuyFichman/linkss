import "server-only";
import { getSupabase, supabaseIdentity } from "@/modules/identity/session";
import { createLeadsService } from "./service";
import { createSupabaseLeadsRepository } from "./supabase-repository";

/** Request-scoped leads service acting as the signed-in user (RLS and RPC checks apply). */
export async function getLeadsService() {
  const supabase = await getSupabase();
  return createLeadsService(supabaseIdentity(supabase), createSupabaseLeadsRepository(supabase));
}
