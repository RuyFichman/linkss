import { createHmac } from "node:crypto";

/**
 * Custom-domain configuration (ADR 0016). All server-only.
 *
 *   signer   DOMAINS_SIGNING_SECRET (the same value lives in Supabase Vault as
 *            `domains_signing_secret`). Without it nothing can be verified: the screen says the
 *            feature is not available in this environment.
 *   provider VERCEL_API_TOKEN + VERCEL_PROJECT_ID (+ VERCEL_TEAM_ID for a team project). Without
 *            them control can still be proven, but the hostname is not attached to the deployment:
 *            the screen says so instead of promising a certificate.
 */
export const DOMAINS_SIGNING_SECRET_MIN_LENGTH = 32;
const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

type Env = Record<string, string | undefined>;

export function domainsSignerFromEnv(env: Env = process.env): ((text: string) => string) | null {
  const secret = env.DOMAINS_SIGNING_SECRET;
  if (!secret || secret.length < DOMAINS_SIGNING_SECRET_MIN_LENGTH) return null;
  return (text) => createHmac("sha256", secret).update(text, "utf8").digest("hex");
}

export interface DomainsProviderConfig {
  token: string;
  projectId: string;
  teamId: string | null;
  apiBaseUrl: string | null;
}

export type DomainsProviderResolution = { kind: "vercel"; config: DomainsProviderConfig } | { kind: "none"; reason: "missing_credentials" | "base_url_not_allowed" };

export function resolveDomainsProvider(env: Env = process.env): DomainsProviderResolution {
  const token = (env.VERCEL_API_TOKEN ?? "").trim();
  const projectId = (env.VERCEL_PROJECT_ID ?? "").trim();
  if (token.length < 20 || projectId === "") return { kind: "none", reason: "missing_credentials" };
  const baseUrl = (env.VERCEL_API_BASE_URL ?? "").trim();
  // An override is the local emulator and nothing else: the token never goes to an arbitrary host.
  if (baseUrl !== "" && !LOOPBACK_URL.test(baseUrl)) return { kind: "none", reason: "base_url_not_allowed" };
  return { kind: "vercel", config: { token, projectId, teamId: (env.VERCEL_TEAM_ID ?? "").trim() || null, apiBaseUrl: baseUrl || null } };
}

/** Hostnames this deployment answers on, which nobody may attach to a page. */
export function ownHostnames(env: Env = process.env): string[] {
  try {
    const host = new URL(env.NEXT_PUBLIC_APP_URL ?? "").hostname.toLowerCase();
    return host.includes(".") ? [host.replace(/^www\./, "")] : [];
  } catch {
    return [];
  }
}
