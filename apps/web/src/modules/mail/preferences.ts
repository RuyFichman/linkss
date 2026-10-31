"use server";

import { getCopy } from "@/modules/identity/locale";
import type { FormState } from "@/lib/form-state";
import { logEvent } from "@/lib/observability/logger";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";

/**
 * The one e-mail a person may turn off: the notice of a new form contact (ADR 0021). Written with
 * the person's own session: RLS lets each one change only their own row, and the column grant
 * lets them change only this field and their name.
 */
export async function setNewLeadNoticesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { MAIL_PREFERENCES_COPY } = await getCopy();
  const userId = await getCurrentUserId();
  if (!userId) return { status: "error", message: MAIL_PREFERENCES_COPY.error, code: "unauthenticated" };
  const enabled = formData.get("newLeads") === "on";
  const { error, count } = await (await getSupabase()).from("user_accounts").update({ notify_new_leads: enabled }, { count: "exact" }).eq("id", userId);
  logEvent(error ? "error" : "info", "mail.preference", { outcome: error ? "unavailable" : count === 1 ? "ok" : "not_found", enabled });
  if (error || count !== 1) return { status: "error", message: MAIL_PREFERENCES_COPY.error, code: "unavailable" };
  return { status: "success", message: MAIL_PREFERENCES_COPY.saved };
}
