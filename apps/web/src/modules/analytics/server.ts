import "server-only";
import { getSupabase, supabaseIdentity } from "@/modules/identity/session";
import { createAnalyticsService } from "./service";
import { createSupabaseAnalyticsRepository, createSupabaseWorkspaceAnalyticsRepository } from "./supabase-repository";
import { createWorkspaceAnalyticsService } from "./workspace-service";

/** Request-scoped analytics service acting as the signed-in user (the RPCs re-check membership). */
export async function getAnalyticsService() {
  const supabase = await getSupabase();
  return createAnalyticsService(supabaseIdentity(supabase), createSupabaseAnalyticsRepository(supabase));
}

/** Request-scoped consolidated analytics of a workspace, acting as the signed-in user. */
export async function getWorkspaceAnalyticsService() {
  const supabase = await getSupabase();
  return createWorkspaceAnalyticsService(supabaseIdentity(supabase), createSupabaseWorkspaceAnalyticsRepository(supabase));
}
