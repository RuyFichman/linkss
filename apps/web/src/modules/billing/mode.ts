/**
 * Billing mode (ADR 0014). A server-only setting with three values. `off` is what the product did
 * before billing existed and is the answer whenever anything is missing or inconsistent: no
 * checkout button, the limit screens keep their sentence, nothing errors.
 *
 *   off      default
 *   sandbox  a provider TEST key: checkout is shown and every billing screen says it is a test
 *   live     a provider LIVE key: real charges
 *
 * The mode asked for and the kind of key must agree. A live key under `sandbox` or a test key under
 * `live` resolves to `off`, so a configuration mistake can neither charge real money in a test
 * environment nor present a test checkout as a real offer.
 */
export type BillingMode = "off" | "sandbox" | "live";

export type BillingModeReason =
  | "ok"
  | "disabled"
  | "unknown_mode"
  | "missing_provider_key"
  | "missing_webhook_secret"
  | "missing_signing_secret"
  | "key_mode_mismatch"
  | "base_url_not_allowed"
  | "insecure_app_url";

export interface BillingConfig {
  mode: BillingMode;
  reason: BillingModeReason;
}

export interface BillingSecrets {
  providerKey: string;
  webhookSecret: string;
  signingSecret: string;
  /** Only in sandbox, and only a loopback address: the local Stripe emulator (scripts/billing-lifecycle.mjs). */
  apiBaseUrl: string | null;
}

export const BILLING_SIGNING_SECRET_MIN_LENGTH = 32;
const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

type Env = Record<string, string | undefined>;

function off(reason: BillingModeReason): BillingConfig {
  return { mode: "off", reason };
}

export function resolveBillingMode(env: Env = process.env): BillingConfig {
  const asked = (env.BILLING_MODE ?? "off").trim().toLowerCase();
  if (asked === "" || asked === "off") return off("disabled");
  if (asked !== "sandbox" && asked !== "live") return off("unknown_mode");

  const key = env.STRIPE_SECRET_KEY ?? "";
  if (key.length < 20) return off("missing_provider_key");
  if (!(env.STRIPE_WEBHOOK_SECRET ?? "").startsWith("whsec_") || (env.STRIPE_WEBHOOK_SECRET ?? "").length < 20) return off("missing_webhook_secret");
  if ((env.BILLING_SIGNING_SECRET ?? "").length < BILLING_SIGNING_SECRET_MIN_LENGTH) return off("missing_signing_secret");

  const testKey = /^(sk|rk)_test_/.test(key);
  const liveKey = /^(sk|rk)_live_/.test(key);
  if ((asked === "sandbox" && !testKey) || (asked === "live" && !liveKey)) return off("key_mode_mismatch");

  const baseUrl = (env.STRIPE_API_BASE_URL ?? "").trim();
  if (baseUrl !== "" && (asked === "live" || !LOOPBACK_URL.test(baseUrl))) return off("base_url_not_allowed");
  if (asked === "live" && !(env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://")) return off("insecure_app_url");

  return { mode: asked, reason: "ok" };
}

/** The secrets of an enabled mode, or null when billing is off. Never logged, never sent to a browser. */
export function billingSecrets(env: Env = process.env): BillingSecrets | null {
  if (resolveBillingMode(env).mode === "off") return null;
  const baseUrl = (env.STRIPE_API_BASE_URL ?? "").trim();
  return {
    providerKey: env.STRIPE_SECRET_KEY as string,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
    signingSecret: env.BILLING_SIGNING_SECRET as string,
    apiBaseUrl: baseUrl === "" ? null : baseUrl,
  };
}
