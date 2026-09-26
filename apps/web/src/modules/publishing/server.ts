import "server-only";
import { cache } from "react";
import { logEvent } from "@/lib/observability/logger";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { getSupabase, supabaseIdentity } from "@/modules/identity/session";
import { mapPublicPageRow, PublicPageUnavailableError, type PublicPageResult } from "./public-page";
import { createPublishingService } from "./service";
import { createSupabasePublishingRepository } from "./supabase-repository";

/**
 * Resolves a public address. Deduplicated per render (page + metadata + OG image share one call);
 * across requests the page itself is cached by ISR, so the database sees one call per regeneration.
 * Errors throw: Next keeps serving the previous cached page and retries on the next request.
 */
export const getPublicPage = cache(async (slug: string): Promise<PublicPageResult> => {
  const startedAt = performance.now();
  const { data, error } = await createPublicSupabaseClient().rpc("get_public_page", { p_slug: slug }).maybeSingle();
  if (error) {
    logEvent("error", "public_page.lookup_failed", { errorCode: error.code, durationMs: Math.round(performance.now() - startedAt) });
    throw new PublicPageUnavailableError("lookup_failed");
  }
  try {
    const result = mapPublicPageRow(data);
    logEvent("info", "public_page.resolved", {
      state: result.state,
      version: result.state === "published" ? result.version : undefined,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (mappingError) {
    logEvent("error", "public_page.invalid_document", { durationMs: Math.round(performance.now() - startedAt) });
    throw mappingError;
  }
});

/** Request-scoped publishing service acting as the signed-in user (RLS and RPC checks apply). */
export async function getPublishingService() {
  const supabase = await getSupabase();
  return createPublishingService(supabaseIdentity(supabase), createSupabasePublishingRepository(supabase));
}

export async function getPublishingRepository() {
  return createSupabasePublishingRepository(await getSupabase());
}
