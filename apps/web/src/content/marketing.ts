import type { Locale } from "@/lib/locale";
import * as es from "./es-ES";
import { BILLING_COPY, HOME_COPY, SHOWCASE_COPY } from "./pt-BR";
import type { HomeCopy, MarketingBillingCopy, ShowcaseCopy } from "./types";

/** Everything the marketing home says, in one language (ADR 0022). */
export interface MarketingCopy {
  home: HomeCopy;
  showcase: ShowcaseCopy;
  billing: MarketingBillingCopy;
}

const MARKETING: Record<Locale, MarketingCopy> = {
  "pt-BR": { home: HOME_COPY, showcase: SHOWCASE_COPY, billing: BILLING_COPY },
  "es-ES": { home: es.HOME_COPY, showcase: es.SHOWCASE_COPY, billing: es.BILLING_COPY },
};

export function marketingCopy(locale: Locale): MarketingCopy {
  return MARKETING[locale];
}

