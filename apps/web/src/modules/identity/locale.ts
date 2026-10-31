import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { copyFor, type Copy } from "@/content/copy";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isLocale, type Locale } from "@/lib/locale";
import { getCurrentUserId, getSupabase } from "./session";

/**
 * The language of this request (ADR 0022), once per request: the signed-in person's account
 * language, else the cookie set by `?idioma=` on the auth pages, else pt-BR. A failure to read
 * the account falls back instead of failing the page.
 */
export const getRequestLocale = cache(async (): Promise<Locale> => {
  const userId = await getCurrentUserId();
  if (userId) {
    const { data, error } = await (await getSupabase()).from("user_accounts").select("locale").eq("id", userId).maybeSingle();
    if (!error && isLocale(data?.locale)) return data.locale;
  }
  const chosen = (await headers()).get(LOCALE_HEADER);
  if (isLocale(chosen)) return chosen;
  const remembered = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(remembered) ? remembered : DEFAULT_LOCALE;
});

/** Every copy object in the language of this request. */
export async function getCopy(): Promise<Copy> {
  return copyFor(await getRequestLocale());
}
