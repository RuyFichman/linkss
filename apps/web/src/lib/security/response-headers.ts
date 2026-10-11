/**
 * Baseline browser policy. The App Router emits inline bootstrap scripts and the editor uses
 * inline theme styles, so those two allowances are scoped to scripts/styles; event-handler
 * attributes, arbitrary frames, objects and cross-origin forms remain blocked. A nonce-based
 * policy would make the cacheable public renderer dynamic, so that change needs its own design.
 */
function originFrom(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Vendor origins of the two measurement tools a page owner may connect (ADR 0017). Allowed only on
 * public pages (`publicPage: true`): the product area, sign-in and every other route keep the
 * baseline. Nothing here is requested before the visitor consents; the allowance only makes the
 * request possible afterwards. Google's list follows its Content-Security-Policy guide for GA4.
 */
const PIXEL_SCRIPT_ORIGINS = ["https://connect.facebook.net", "https://www.googletagmanager.com"];
const PIXEL_CONNECT_ORIGINS = ["https://www.facebook.com", "https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com"];
const PIXEL_IMAGE_ORIGINS = ["https://www.facebook.com", "https://*.google-analytics.com", "https://*.googletagmanager.com"];

/** Cloudflare Turnstile (ADR 0018): its script, and the frame it draws the challenge in. */
const CAPTCHA_ORIGIN = "https://challenges.cloudflare.com";

export interface PolicyOptions {
  /** A route that renders a published page for visitors. */
  publicPage?: boolean;
  /** A sign-in, sign-up or e-mail request form in an environment that has a CAPTCHA site key. */
  captcha?: boolean;
}

export function contentSecurityPolicy(supabaseUrl: string | undefined, development: boolean, mediaUrl?: string, options: PolicyOptions = {}): string {
  const pixels = options.publicPage === true;
  const captcha = options.captcha === true ? ` ${CAPTCHA_ORIGIN}` : "";
  const supabaseOrigin = originFrom(supabaseUrl);
  const connect = ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : []), ...(development ? ["ws://localhost:*", "ws://127.0.0.1:*"] : []), ...(pixels ? PIXEL_CONNECT_ORIGINS : [])];
  const imageOrigins = new Set([supabaseOrigin, originFrom(mediaUrl)].filter((origin): origin is string => origin !== null));
  const image = ["'self'", "data:", "blob:", ...imageOrigins, ...(pixels ? PIXEL_IMAGE_ORIGINS : [])];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}${pixels ? ` ${PIXEL_SCRIPT_ORIGINS.join(" ")}` : ""}${captcha}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src ${image.join(" ")}`,
    `connect-src ${connect.join(" ")}`,
    `frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://open.spotify.com${captcha}`,
    "media-src 'none'",
  ].join("; ");
}

export function siteSecurityHeaders(supabaseUrl: string | undefined, development: boolean, mediaUrl?: string, options: PolicyOptions = {}) {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(supabaseUrl, development, mediaUrl, options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ];
}

/**
 * Source pattern of the public page route `/[slug]`: one path segment in slug form that is not one
 * of the product's own top-level routes. Sign-in, sign-up and the legal pages are single segments
 * too and must keep the baseline policy.
 */
/** The four routes that render a form checked by the CAPTCHA. */
export const CAPTCHA_ROUTE_SOURCE = "/:path(entrar|cadastro|confirmar-email|recuperar-acesso)";

export function publicPageSource(reservedSlugs: readonly string[]): string {
  return `/:slug((?!(?:${reservedSlugs.join("|")})$)[a-z0-9]+(?:-[a-z0-9]+)*)`;
}
