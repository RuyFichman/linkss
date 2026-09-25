import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/observability/logger";
import { redactAuditMetadata, type AuditAction } from "./redaction";

type AuthAuditAction = Extract<AuditAction, `auth.${string}`>;

/**
 * Records an authentication event through the record_auth_event RPC (actor = auth.uid()).
 * Best-effort: a failure is logged and never blocks the person's sign-in or sign-out. Workspace
 * events are written by the database RPCs in the same transaction as the change instead.
 */
export async function recordAuthEvent(supabase: SupabaseServerClient, action: AuthAuditAction, metadata: Readonly<Record<string, unknown>> = {}): Promise<void> {
  const { error } = await supabase.rpc("record_auth_event", { p_action: action, p_metadata: redactAuditMetadata(metadata) });
  if (error) logEvent("warn", "audit.write_failed", { action, errorCode: error.code });
}
