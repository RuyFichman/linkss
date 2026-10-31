"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS, isLocale } from "@/lib/locale";
import { logEvent } from "@/lib/observability/logger";
import { copyFor } from "@/content/copy";
import { getCopy } from "./locale";
import { getCurrentUserId, getSupabase } from "./session";

/**
 * The account's language (ADR 0022): the screens and the e-mails sent to this person. Written with
 * the person's own session: RLS lets each one change only their own row, and the column grant
 * covers `locale`. The cookie keeps the choice for the sign-in screens after signing out.
 */
export async function setAccountLocaleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { MY_DATA_COPY } = await getCopy();
  const userId = await getCurrentUserId();
  if (!userId) return { status: "error", message: MY_DATA_COPY.locale.error, code: "unauthenticated" };
  const locale = formData.get("locale");
  if (!isLocale(locale)) return { status: "error", message: MY_DATA_COPY.locale.error, code: "validation" };
  const supabase = await getSupabase();
  const { error, count } = await supabase.from("user_accounts").update({ locale }, { count: "exact" }).eq("id", userId);
  logEvent(error ? "error" : "info", "account.locale", { outcome: error ? "unavailable" : count === 1 ? "ok" : "not_found", locale });
  if (error || count !== 1) return { status: "error", message: MY_DATA_COPY.locale.error, code: "unavailable" };
  // Supabase Auth writes its own e-mails (confirmation, recovery) from the user metadata, which the
  // sign-up set: keep it in step. A failure here leaves only those e-mails in the old language.
  const { error: metadataError } = await supabase.auth.updateUser({ data: { locale } });
  if (metadataError) logEvent("warn", "account.locale_metadata", { outcome: "unavailable" });
  (await cookies()).set(LOCALE_COOKIE, locale, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS });
  // The whole account re-renders in the new language; the confirmation is already in it.
  refresh();
  return { status: "success", message: copyFor(locale).MY_DATA_COPY.locale.saved };
}
