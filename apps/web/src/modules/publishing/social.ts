import { normalizeUrl } from "@/modules/editor/model/urls";

/**
 * Social networks shown as icons in the page header. `hosts` must equal
 * private.social_network_hosts() in supabase/migrations (drift-tested): an icon that says
 * "Instagram" may only point to Instagram.
 */
export const SOCIAL_NETWORKS = {
  instagram: { label: "Instagram", hosts: ["instagram.com"], handleUrl: (handle: string) => `https://www.instagram.com/${handle}` },
  tiktok: { label: "TikTok", hosts: ["tiktok.com"], handleUrl: (handle: string) => `https://www.tiktok.com/@${handle}` },
  youtube: { label: "YouTube", hosts: ["youtube.com", "youtu.be"], handleUrl: (handle: string) => `https://www.youtube.com/@${handle}` },
  facebook: { label: "Facebook", hosts: ["facebook.com", "fb.com"], handleUrl: (handle: string) => `https://www.facebook.com/${handle}` },
  linkedin: { label: "LinkedIn", hosts: ["linkedin.com"], handleUrl: (handle: string) => `https://www.linkedin.com/in/${handle}` },
  x: { label: "X (Twitter)", hosts: ["x.com", "twitter.com"], handleUrl: (handle: string) => `https://x.com/${handle}` },
  threads: { label: "Threads", hosts: ["threads.net", "threads.com"], handleUrl: (handle: string) => `https://www.threads.net/@${handle}` },
  pinterest: { label: "Pinterest", hosts: ["pinterest.com", "pin.it"], handleUrl: (handle: string) => `https://www.pinterest.com/${handle}` },
} as const;

export type SocialNetwork = keyof typeof SOCIAL_NETWORKS;
export const SOCIAL_NETWORK_IDS = Object.keys(SOCIAL_NETWORKS) as SocialNetwork[];
export const SOCIAL_URL_MAX_LENGTH = 300;

export interface SocialLink {
  network: SocialNetwork;
  url: string;
}

export function isSocialNetwork(value: unknown): value is SocialNetwork {
  return typeof value === "string" && Object.hasOwn(SOCIAL_NETWORKS, value);
}

function hostAllowed(hostname: string, hosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** True only for an https URL, without credentials, on one of the network's hosts. */
export function isAllowedSocialUrl(network: SocialNetwork, value: string): boolean {
  if (value.length > SOCIAL_URL_MAX_LENGTH || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && hostAllowed(url.hostname, SOCIAL_NETWORKS[network].hosts);
  } catch {
    return false;
  }
}

const HANDLE_PATTERN = /^@?([\p{L}\p{N}._-]{1,60})$/u;

export type SocialInputResult = { ok: true; url: string } | { ok: false; reason: "invalid" | "wrong_network" };

/**
 * Accepts a profile URL or a bare handle ("@ana", "ana.lima") and returns the canonical https URL.
 * http is upgraded to https; hosts outside the network's allowlist are rejected.
 */
export function normalizeSocialInput(network: SocialNetwork, input: string): SocialInputResult {
  const trimmed = input.trim();
  const handle = HANDLE_PATTERN.exec(trimmed);
  if (handle && !trimmed.includes("/") && !hostAllowed(trimmed, SOCIAL_NETWORKS[network].hosts)) {
    return { ok: true, url: SOCIAL_NETWORKS[network].handleUrl(encodeURIComponent(handle[1] ?? "")) };
  }

  const normalized = normalizeUrl(trimmed);
  if (!normalized.ok) return { ok: false, reason: "invalid" };
  const url = new URL(normalized.url);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password) return { ok: false, reason: "invalid" };
  if (!hostAllowed(url.hostname, SOCIAL_NETWORKS[network].hosts)) return { ok: false, reason: "wrong_network" };
  const value = url.toString();
  return isAllowedSocialUrl(network, value) ? { ok: true, url: value } : { ok: false, reason: "invalid" };
}
