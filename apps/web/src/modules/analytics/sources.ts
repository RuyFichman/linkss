/**
 * Traffic source of a visit (ADR 0011). The referrer is reduced to a host, the host is classified
 * into a closed set, and only the class is stored: no URL, path, query string or host ever reaches
 * the database. Mirror of `public.analytics_source`.
 */
export const TRAFFIC_SOURCES = ["direct", "instagram", "facebook", "whatsapp", "tiktok", "youtube", "x", "linkedin", "telegram", "google", "search", "other"] as const;
export type TrafficSource = (typeof TRAFFIC_SOURCES)[number];

export function isTrafficSource(value: unknown): value is TrafficSource {
  return typeof value === "string" && (TRAFFIC_SOURCES as readonly string[]).includes(value);
}

/** Registrable domains (and their subdomains) of each source. */
const SOURCE_DOMAINS: Array<[TrafficSource, readonly string[]]> = [
  ["instagram", ["instagram.com", "ig.me"]],
  ["facebook", ["facebook.com", "fb.com", "fb.me", "messenger.com"]],
  ["whatsapp", ["whatsapp.com", "wa.me", "wa.link"]],
  ["tiktok", ["tiktok.com"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["x", ["t.co", "twitter.com", "x.com"]],
  ["linkedin", ["linkedin.com", "lnkd.in"]],
  ["telegram", ["t.me", "telegram.org", "telegram.me"]],
  ["search", ["bing.com", "duckduckgo.com", "yahoo.com", "ecosia.org", "brave.com", "yandex.com", "yandex.ru"]],
];

/** Android apps report `android-app://<package>` instead of a web address. */
const ANDROID_PACKAGES: Record<string, TrafficSource> = {
  "com.instagram.android": "instagram",
  "com.facebook.katana": "facebook",
  "com.facebook.lite": "facebook",
  "com.facebook.orca": "facebook",
  "com.whatsapp": "whatsapp",
  "com.whatsapp.w4b": "whatsapp",
  "com.zhiliaoapp.musically": "tiktok",
  "com.ss.android.ugc.trill": "tiktok",
  "com.google.android.youtube": "youtube",
  "com.twitter.android": "x",
  "com.linkedin.android": "linkedin",
  "org.telegram.messenger": "telegram",
  "com.google.android.googlequicksearchbox": "google",
  "com.google.android.gm": "other",
};

/** `utm_source` values people actually write, for visits that arrive without a referrer. */
const UTM_SOURCE_ALIASES: Record<string, TrafficSource> = {
  instagram: "instagram", ig: "instagram", insta: "instagram",
  facebook: "facebook", fb: "facebook", meta: "facebook",
  whatsapp: "whatsapp", wa: "whatsapp", zap: "whatsapp",
  tiktok: "tiktok",
  youtube: "youtube", yt: "youtube",
  twitter: "x", x: "x",
  linkedin: "linkedin",
  telegram: "telegram",
  google: "google",
};

const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const GOOGLE_HOST = /(?:^|\.)google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/;
const ANDROID_APP = /^android-app:\/\/([a-z0-9_.]+)/;

/**
 * Lowercase host of a referrer, or null. Accepts a bare host (what the collector sends) or a full
 * address (what a forged request may send): everything after the host is discarded here.
 */
export function referrerHost(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().toLowerCase();
  if (!text || text.length > 255) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, "");
  return HOST_PATTERN.test(host) ? host : null;
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function classifyHost(host: string): TrafficSource {
  for (const [source, domains] of SOURCE_DOMAINS) {
    if (domains.some((domain) => matchesDomain(host, domain))) return source;
  }
  return GOOGLE_HOST.test(host) ? "google" : "other";
}

/**
 * UTM value in its stored form, or null. Lowercased, spaces and "+" become "-", and anything
 * outside `[a-z0-9_.-]` (or longer than 40 characters) discards the whole value instead of
 * storing an altered one. Mirror of private.analytics_utm_is_valid.
 */
export const UTM_MAX_LENGTH = 40;
const UTM_PATTERN = /^[a-z0-9_.-]{1,40}$/;

export function normalizeUtmValue(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().toLowerCase().replace(/[\s+]+/g, "-");
  return UTM_PATTERN.test(text) ? text : null;
}

export interface UtmValues {
  source: string | null;
  medium: string | null;
  campaign: string | null;
}

/** Medium and campaign only make sense next to a source; without one the triple is dropped. */
export function normalizeUtm(raw: { source: string | null; medium: string | null; campaign: string | null }): UtmValues {
  const source = normalizeUtmValue(raw.source);
  if (!source) return { source: null, medium: null, campaign: null };
  return { source, medium: normalizeUtmValue(raw.medium), campaign: normalizeUtmValue(raw.campaign) };
}

/**
 * Source of a visit. The referrer decides when it names a known network; an empty referrer, the
 * product's own host or an unknown site fall back to a recognized `utm_source` (in-app browsers
 * often send no referrer at all).
 */
export function classifySource(referrer: string | null | undefined, utmSource: string | null, ownHost: string | null): TrafficSource {
  const text = (referrer ?? "").trim().toLowerCase();
  const androidPackage = ANDROID_APP.exec(text)?.[1];
  let fromReferrer: TrafficSource = "direct";
  if (androidPackage) {
    fromReferrer = ANDROID_PACKAGES[androidPackage] ?? "other";
  } else {
    const host = referrerHost(text);
    if (host && host !== ownHost?.toLowerCase()) fromReferrer = classifyHost(host);
  }
  if (fromReferrer !== "direct" && fromReferrer !== "other") return fromReferrer;
  const fromUtm = utmSource ? UTM_SOURCE_ALIASES[utmSource] : undefined;
  return fromUtm ?? fromReferrer;
}
