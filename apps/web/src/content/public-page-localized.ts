import { PIX_KEY_TYPE_LABELS as PIX_ES, PUBLIC_PAGE_COPY as PUBLIC_PAGE_ES } from "./public-page-es-ES";
import { PIX_KEY_TYPE_LABELS as PIX_PT, PUBLIC_PAGE_COPY as PUBLIC_PAGE_PT } from "./public-page";

/**
 * What visitors of a public page read, in the page's language (`profiles.locale`, ADR 0022), not
 * the viewer's. The only copy modules in the public page's client bundle.
 */
export const PUBLIC_PAGE_COPY = { "pt-BR": PUBLIC_PAGE_PT, "es-ES": PUBLIC_PAGE_ES } as const;
export const PIX_KEY_TYPE_LABELS = { "pt-BR": PIX_PT, "es-ES": PIX_ES } as const;
