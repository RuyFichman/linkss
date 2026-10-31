import "server-only";
import { getCopy } from "@/modules/identity/locale";
import { getSupabase, supabaseIdentity } from "@/modules/identity/session";
import { createProfileService } from "./service";
import { createSupabaseProfileRepository } from "./supabase-repository";

/** Request-scoped profile service acting as the signed-in user (RLS applies to every call). */
export async function getProfileService() {
  const supabase = await getSupabase();
  const { APP_COPY, AUTH_COPY, SLUG_COPY } = await getCopy();
  return createProfileService(supabaseIdentity(supabase), createSupabaseProfileRepository(supabase), APP_COPY, AUTH_COPY, SLUG_COPY);
}

export async function getProfileRepository() {
  return createSupabaseProfileRepository(await getSupabase());
}
