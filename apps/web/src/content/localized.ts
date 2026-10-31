import * as es from "./es-ES";
import * as pt from "./pt-BR";

/**
 * Copy namespaces keyed by language, for client components (`useCopy(EDITOR_COPY)`, see
 * ui/locale-context.tsx). Plain object literals, one export per namespace, so a bundle keeps only
 * the namespaces its components import. content/copy.ts checks that both languages have the same
 * shape. The public page's copy has its own module (public-page-localized.ts).
 */
export const UI_COPY = { "pt-BR": pt.UI_COPY, "es-ES": es.UI_COPY } as const;
export const COPY = { "pt-BR": pt.COPY, "es-ES": es.COPY } as const;
export const AUTH_COPY = { "pt-BR": pt.AUTH_COPY, "es-ES": es.AUTH_COPY } as const;
export const APP_COPY = { "pt-BR": pt.APP_COPY, "es-ES": es.APP_COPY } as const;
export const SLUG_COPY = { "pt-BR": pt.SLUG_COPY, "es-ES": es.SLUG_COPY } as const;
export const MODERATION_COPY = { "pt-BR": pt.MODERATION_COPY, "es-ES": es.MODERATION_COPY } as const;
export const TEAM_COPY = { "pt-BR": pt.TEAM_COPY, "es-ES": es.TEAM_COPY } as const;
export const PUBLISHING_COPY = { "pt-BR": pt.PUBLISHING_COPY, "es-ES": es.PUBLISHING_COPY } as const;
export const BLOCKS_COPY = { "pt-BR": pt.BLOCKS_COPY, "es-ES": es.BLOCKS_COPY } as const;
export const EDITOR_COPY = { "pt-BR": pt.EDITOR_COPY, "es-ES": es.EDITOR_COPY } as const;
export const MEDIA_COPY = { "pt-BR": pt.MEDIA_COPY, "es-ES": es.MEDIA_COPY } as const;
export const THEME_COPY = { "pt-BR": pt.THEME_COPY, "es-ES": es.THEME_COPY } as const;
export const TEMPLATES_COPY = { "pt-BR": pt.TEMPLATES_COPY, "es-ES": es.TEMPLATES_COPY } as const;
export const LEADS_COPY = { "pt-BR": pt.LEADS_COPY, "es-ES": es.LEADS_COPY } as const;
export const ANALYTICS_COPY = { "pt-BR": pt.ANALYTICS_COPY, "es-ES": es.ANALYTICS_COPY } as const;
export const REPORTS_COPY = { "pt-BR": pt.REPORTS_COPY, "es-ES": es.REPORTS_COPY } as const;
export const BILLING_COPY = { "pt-BR": pt.BILLING_COPY, "es-ES": es.BILLING_COPY } as const;
export const DOMAINS_COPY = { "pt-BR": pt.DOMAINS_COPY, "es-ES": es.DOMAINS_COPY } as const;
export const PIXELS_COPY = { "pt-BR": pt.PIXELS_COPY, "es-ES": es.PIXELS_COPY } as const;
export const MY_DATA_COPY = { "pt-BR": pt.MY_DATA_COPY, "es-ES": es.MY_DATA_COPY } as const;
export const MAIL_PREFERENCES_COPY = { "pt-BR": pt.MAIL_PREFERENCES_COPY, "es-ES": es.MAIL_PREFERENCES_COPY } as const;
