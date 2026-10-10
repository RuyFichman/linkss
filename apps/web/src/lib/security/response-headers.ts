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

export function contentSecurityPolicy(supabaseUrl: string | undefined, development: boolean, mediaUrl?: string): string {
  const supabaseOrigin = originFrom(supabaseUrl);
  const connect = ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : []), ...(development ? ["ws://localhost:*", "ws://127.0.0.1:*"] : [])];
  const imageOrigins = new Set([supabaseOrigin, originFrom(mediaUrl)].filter((origin): origin is string => origin !== null));
  const image = ["'self'", "data:", "blob:", ...imageOrigins];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src ${image.join(" ")}`,
    `connect-src ${connect.join(" ")}`,
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://open.spotify.com",
    "media-src 'none'",
  ].join("; ");
}

export function siteSecurityHeaders(supabaseUrl: string | undefined, development: boolean, mediaUrl?: string) {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(supabaseUrl, development, mediaUrl) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ];
}
