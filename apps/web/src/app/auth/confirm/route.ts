import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { recordAuthEvent } from "@/modules/audit/record";
import { parseLinkType } from "@/modules/identity/auth-outcomes";
import { safeNextPath } from "@/modules/identity/redirects";
import { ensurePersonalWorkspace, getSupabase } from "@/modules/identity/session";

export const dynamic = "force-dynamic";

/**
 * Email link landing (ADR 0005). Verifies `token_hash` (cross-device) or, as a fallback for default
 * hosted templates, exchanges a PKCE `code`. Links expire after 1 hour and are single-use.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
  const type = parseLinkType(params.get("type"));
  const tokenHash = params.get("token_hash");
  const code = params.get("code");
  const isRecovery = type === "recovery" || params.get("next") === "/redefinir-senha";

  const supabase = await getSupabase();
  let failed = true;
  let errorCode: string | null = "missing_token";
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failed = Boolean(error);
    errorCode = error?.code ?? null;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
    errorCode = error?.code ?? null;
  }

  logEvent(failed ? "warn" : "info", "auth.email_link", { correlationId, type: type ?? (code ? "code" : "unknown"), outcome: failed ? "rejected" : "verified", errorCode });
  if (failed) redirect(isRecovery ? "/recuperar-acesso?erro=link-expirado" : "/confirmar-email?erro=link-expirado");

  if (isRecovery) redirect("/redefinir-senha");

  await recordAuthEvent(supabase, "auth.sign_in", { method: "email_link", correlation_id: correlationId });
  // Creates the personal workspace right after verification; the /app layout retries on failure.
  const workspaceId = await ensurePersonalWorkspace(supabase);
  if (!workspaceId) logEvent("error", "identity.personal_workspace_failed", { correlationId });
  redirect(safeNextPath(params.get("next")));
}
