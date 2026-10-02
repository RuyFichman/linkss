import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabase, supabaseIdentity } from "@/modules/identity/session";
import { mediaSignerFromEnv } from "./attestation";
import { processUpload } from "./process";
import { createMediaService } from "./service";
import { createSupabaseStorageAdapter } from "./storage/supabase-adapter";
import { createSupabaseMediaRepository } from "./supabase-repository";

/**
 * Request-scoped media service acting as the signed-in user: the RPCs and the Storage policy see
 * that person's session. The secret key is not involved in uploads (ADR 0009).
 */
export async function getMediaService() {
  const supabase = await getSupabase();
  return createMediaService(supabaseIdentity(supabase), createSupabaseMediaRepository(supabase), createSupabaseStorageAdapter(supabase), {
    sign: mediaSignerFromEnv(),
    process: processUpload,
    newId: randomUUID,
  });
}
