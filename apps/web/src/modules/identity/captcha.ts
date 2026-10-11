/**
 * Sign-up, sign-in and e-mail request forms carry a Cloudflare Turnstile token when the
 * environment has a site key (ADR 0018). The token is checked by Supabase Auth, which holds the
 * secret key: this application never sees the secret and never decides whether a token is valid.
 *
 * Without `NEXT_PUBLIC_TURNSTILE_SITE_KEY` no widget is rendered and no token is sent, which is
 * the right behaviour only while CAPTCHA is off in Supabase Auth. Turning it on there before the
 * site key reaches the deployment makes every sign-in fail with `captcha_failed`.
 */
export const CAPTCHA_FIELD = "cf-turnstile-response";
export const CAPTCHA_SCRIPT_ORIGIN = "https://challenges.cloudflare.com";
export const CAPTCHA_SCRIPT_URL = `${CAPTCHA_SCRIPT_ORIGIN}/turnstile/v0/api.js?render=explicit`;
const SITE_KEY = /^[0-9A-Za-z_-]{10,64}$/;
const TOKEN_MAX_LENGTH = 2048;

/** The public site key, or `null` when the environment has none (or something that is not one). */
export function captchaSiteKey(value: string | undefined = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY): string | null {
  const key = value?.trim() ?? "";
  return SITE_KEY.test(key) ? key : null;
}

/** The token the widget put in the form. Client-controlled: only its shape is checked here. */
export function captchaToken(formData: FormData): string | undefined {
  const value = formData.get(CAPTCHA_FIELD);
  return typeof value === "string" && value.length > 0 && value.length <= TOKEN_MAX_LENGTH ? value : undefined;
}
