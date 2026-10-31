import type { Locale } from "@/lib/locale";
import { AUTH_COPY as SPANISH } from "./es-ES";
import { AUTH_COPY } from "./pt-BR";
import type { SignUpCopy } from "./types";

/** The sign-up form and what its action answers, in each language (ADR 0022). Read by a client component. */
export const SIGN_UP_COPY: Record<Locale, SignUpCopy> = { "pt-BR": AUTH_COPY, "es-ES": SPANISH };
