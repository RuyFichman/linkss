import type { AUTH_COPY, BILLING_COPY, HOME_COPY, SHOWCASE_COPY } from "./pt-BR";

/**
 * The shape of a copy object without its literal strings, so another language can fill it
 * (ADR 0022). Functions keep their parameters; arrays and nested objects are widened too.
 */
export type Widen<T> = T extends string
  ? string
  : T extends (...args: infer Args) => infer Result
    ? (...args: Args) => Widen<Result>
    : T extends readonly (infer Item)[]
      ? readonly Widen<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: Widen<T[Key]> }
        : T;

export type HomeCopy = Widen<typeof HOME_COPY>;
export type ShowcaseCopy = Widen<typeof SHOWCASE_COPY>;

/** The billing words the marketing home and its comparison table read. */
export type MarketingBillingCopy = Widen<Pick<typeof BILLING_COPY, "planNames" | "planDescriptions" | "intervals" | "perInterval" | "perShort" | "freePrice" | "freeMonths" | "yearlySaving" | "highlights" | "comparison">> & {
  readonly plans: Widen<Pick<(typeof BILLING_COPY)["plans"], "intervalLegend" | "compare">>;
};

/** The words of the sign-up form and of what its action answers. */
export type SignUpCopy = Widen<Pick<typeof AUTH_COPY, "validation" | "passwordHint" | "signUp" | "rateLimited" | "captcha" | "unavailable" | "fields">>;
