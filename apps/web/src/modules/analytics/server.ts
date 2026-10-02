import "server-only";
import { getSupabase, supabaseIdentity } from "@/modules/identity/session";
import { createAnalyticsService } from "./service";
import { createSupabaseAnalyticsRepository } from "./supabase-repository";

/** Request-scoped analytics service acting as the signed-in user (the RPCs re-check membership). */
export async function getAnalyticsService() {
  const supabase = await getSupabase();
  return createAnalyticsService(supabaseIdentity(supabase), createSupabaseAnalyticsRepository(supabase));
}
