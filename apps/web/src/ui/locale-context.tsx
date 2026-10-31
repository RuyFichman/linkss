"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Widen } from "@/content/types";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Gives client components the language the server resolved for this request (ADR 0022). */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * One copy namespace in the current language. Pass a record from content/localized.ts, so the
 * client bundle carries only the namespaces a component uses.
 */
export function useCopy<Words>(byLocale: { readonly "pt-BR": Words; readonly "es-ES": unknown }): Widen<Words> {
  // content/copy.ts checks that the Spanish side has the Portuguese shape.
  return byLocale[useLocale()] as Widen<Words>;
}