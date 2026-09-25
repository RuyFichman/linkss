export const PRODUCT = {
  codename: "Projeto LNK",
  market: "BR",
  locale: "pt-BR",
  currency: "BRL",
  plans: {
    free: { monthlyPriceInCents: 0, includedProfiles: 1 },
    pro: { monthlyPriceInCents: 1490, includedProfiles: 1 },
    agency: { monthlyPriceInCents: 5790, includedProfiles: 10 },
  },
} as const;
