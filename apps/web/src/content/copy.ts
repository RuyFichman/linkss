import type { Locale } from "@/lib/locale";
import * as spanish from "./es-ES";
import * as portuguese from "./pt-BR";
import type { Widen } from "./types";

/**
 * Every copy object of the product, in one language (ADR 0022). The Spanish module must have every
 * export of the Portuguese one with the same shape: the assignment below is the check.
 *
 * Server code reads it with `copyFor(locale)`. Client components must not import this module (it
 * would ship every text in both languages); they read their namespaces through `useCopy`
 * (content/localized.ts).
 */
export type Copy = { readonly [Key in keyof typeof portuguese]: Widen<(typeof portuguese)[Key]> };

const PORTUGUESE: Copy = portuguese;
const SPANISH: Copy = spanish;

export const COPY_BY_LOCALE: Readonly<Record<Locale, Copy>> = { "pt-BR": PORTUGUESE, "es-ES": SPANISH };

export function copyFor(locale: Locale): Copy {
  return COPY_BY_LOCALE[locale];
}
