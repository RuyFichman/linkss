import { HOME_PATH, LOCALE_CODE } from "@/lib/locale";

/** `hreflang` links between the two homes (ADR 0022); `x-default` is the Portuguese one. */
export const HOME_ALTERNATES: Record<string, string> = {
  [LOCALE_CODE["pt-BR"]]: HOME_PATH["pt-BR"],
  [LOCALE_CODE["es-ES"]]: HOME_PATH["es-ES"],
  "x-default": HOME_PATH["pt-BR"],
};
