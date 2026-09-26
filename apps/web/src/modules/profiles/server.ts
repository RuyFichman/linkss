import "server-only";
import { getSupabase, supabaseIdentity } from "@/modules/identity/session";
import { createProfileService } from "./service";
import { createSupabaseProfileRepository } from "./supabase-repository";

/** Request-scoped profile service acting as the signed-in user (RLS applies to every call). */
export async function getProfileService() {
  const supabase = await getSupabase();
  return createProfileService(supabaseIdentity(supabase), createSupabaseProfileRepository(supabase));
}

export async function getProfileRepository() {
  return createSupabaseProfileRepository(await getSupabase());
}
