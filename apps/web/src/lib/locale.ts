import type { Widen } from "@/content/types";

/**
 * Languages the product speaks (ADR 0022). `pt-BR` is the default. The value is what
 * `user_accounts.locale` and `profiles.locale` store, so this list and the table checks change
 * together.
 */
export const LOCALES = ["pt-BR", "es-ES"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt-BR";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The short code in addresses (`/es`, `?idioma=es`) and in the `lang` attribute. */
export const LOCALE_CODE: Record<Locale, string> = { "pt-BR": "pt-BR", "es-ES": "es" };

/** `?idioma=es` → `es-ES`; anything else is the default. */
export function localeFromCode(value: unknown): Locale {
  return value === LOCALE_CODE["es-ES"] ? "es-ES" : DEFAULT_LOCALE;
}

/**
 * Remembers the language of someone who is not signed in yet (set from `?idioma=` on the auth
 * pages and by the account's language setting). A signed-in person's account language wins.
 */
export const LOCALE_COOKIE = "lnk_locale";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
/** Set by the proxy for the request that carried `?idioma=`, before the cookie exists. */
export const LOCALE_HEADER = "x-lnk-locale";

/** The `lang` attribute for a subtree in this language; undefined for the document's own pt-BR. */
export function langAttribute(locale: Locale): string | undefined {
  return locale === DEFAULT_LOCALE ? undefined : LOCALE_CODE[locale];
}

/**
 * One copy namespace in a language, from a record of content/localized.ts or
 * content/public-page-localized.ts. For code outside React; components use `useCopy`.
 */
export function pickCopy<Words>(byLocale: { readonly "pt-BR": Words; readonly "es-ES": unknown }, locale: Locale): Widen<Words> {
  // content/copy.ts checks that the Spanish side has the Portuguese shape.
  return byLocale[locale] as Widen<Words>;
}

/** Where the marketing home of each language lives. */
export const HOME_PATH: Record<Locale, string> = { "pt-BR": "/", "es-ES": "/es" };

/** The sign-up form in each language: the same route, the language in the query (ADR 0022). */
export const SIGN_UP_PATH: Record<Locale, string> = { "pt-BR": "/cadastro", "es-ES": "/cadastro?idioma=es" };
/** The help center of each language (static pages). */
export const HELP_PATH: Record<Locale, string> = { "pt-BR": "/ajuda", "es-ES": "/es/ajuda" };
export const SIGN_IN_PATH: Record<Locale, string> = { "pt-BR": "/entrar", "es-ES": "/entrar?idioma=es" };
