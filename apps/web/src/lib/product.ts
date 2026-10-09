// Commercial hypotheses (PLANO_DE_NEGOCIO §5). Limits are mirrored by the `plan_entitlements` seed and
// prices by the `plan_prices` seed in supabase/migrations; drift tests compare both (ADR 0014).
// Money is integer cents in `currency`. The yearly price is a separate amount, not a formula.
export const PRODUCT = {
  codename: "Projeto LNK",
  market: "BR",
  locale: "pt-BR",
  currency: "BRL",
  plans: {
    free: { monthlyPriceInCents: 0, yearlyPriceInCents: 0, includedProfiles: 1, analyticsDays: 7, teamMembers: 1, storageMb: 20, customDomain: false, removeBadge: false, shareableReports: false },
    pro: { monthlyPriceInCents: 1490, yearlyPriceInCents: 14900, includedProfiles: 1, analyticsDays: 90, teamMembers: 1, storageMb: 100, customDomain: true, removeBadge: true, shareableReports: false },
    agency: { monthlyPriceInCents: 5790, yearlyPriceInCents: 57900, includedProfiles: 10, analyticsDays: 90, teamMembers: 5, storageMb: 500, customDomain: true, removeBadge: true, shareableReports: true },
  },
} as const;

export type PlanId = keyof typeof PRODUCT.plans;
