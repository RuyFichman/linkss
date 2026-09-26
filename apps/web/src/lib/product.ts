// Commercial hypotheses (PLANO_DE_NEGOCIO §5). Prices are not commitments; limits are mirrored by
// the `plan_entitlements` seed in supabase/migrations and checked by a drift test.
export const PRODUCT = {
  codename: "Projeto LNK",
  market: "BR",
  locale: "pt-BR",
  currency: "BRL",
  plans: {
    free: { monthlyPriceInCents: 0, includedProfiles: 1, analyticsDays: 7, teamMembers: 1, customDomain: false, removeBadge: false, shareableReports: false },
    pro: { monthlyPriceInCents: 1490, includedProfiles: 1, analyticsDays: 90, teamMembers: 1, customDomain: true, removeBadge: true, shareableReports: false },
    agency: { monthlyPriceInCents: 5790, includedProfiles: 10, analyticsDays: 90, teamMembers: 5, customDomain: true, removeBadge: true, shareableReports: true },
  },
} as const;

export type PlanId = keyof typeof PRODUCT.plans;
