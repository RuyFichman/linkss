/**
 * Absolute application origin for links sent by email. Taken from configuration, never from the
 * request Host header, so a spoofed host cannot redirect confirmation links elsewhere.
 */
export function appUrl(path = ""): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path}`;
}
