import { normalizeBlockUrl } from "./url-policy";

/**
 * Embed provider allowlist (ADR 0010). A block stores `{provider, ref}` and nothing else: the
 * iframe address is always built here from constants plus an id that matched the provider's
 * pattern. Mirror of private.is_valid_embed_ref(); both run the same malicious-input table.
 *
 * Only providers that work as a plain iframe, without their own script, are listed.
 */
export const EMBED_PROVIDERS = {
  youtube: {
    label: "YouTube",
    hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"],
    refPattern: /^[A-Za-z0-9_-]{11}$/,
  },
  vimeo: {
    label: "Vimeo",
    hosts: ["vimeo.com", "www.vimeo.com", "player.vimeo.com"],
    refPattern: /^[0-9]{6,12}$/,
  },
  spotify: {
    label: "Spotify",
    hosts: ["open.spotify.com"],
    refPattern: /^(?:track|album|playlist|episode|show|artist)\/[A-Za-z0-9]{22}$/,
  },
} as const;

export type EmbedProvider = keyof typeof EMBED_PROVIDERS;
export const EMBED_PROVIDER_IDS = Object.keys(EMBED_PROVIDERS) as EmbedProvider[];

export function isEmbedProvider(value: unknown): value is EmbedProvider {
  return typeof value === "string" && Object.hasOwn(EMBED_PROVIDERS, value);
}

/** True only for an id in the provider's own format. Everything rendered goes through this. */
export function isValidEmbedRef(provider: unknown, ref: unknown): ref is string {
  return isEmbedProvider(provider) && typeof ref === "string" && EMBED_PROVIDERS[provider].refPattern.test(ref);
}

export type EmbedRejection = "required" | "markup" | "address" | "unknown_provider" | "unrecognized";

export type EmbedParseResult =
  | { ok: true; provider: EmbedProvider; ref: string }
  | { ok: false; reason: EmbedRejection };

function providerForHost(host: string): EmbedProvider | null {
  // Exact host match: "youtube.com.evil.example" and "evilyoutube.com" never qualify.
  return EMBED_PROVIDER_IDS.find((provider) => (EMBED_PROVIDERS[provider].hosts as readonly string[]).includes(host)) ?? null;
}

function youtubeRef(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "youtu.be") return segments.length === 1 ? segments[0] ?? null : null;
  if (segments.length === 1 && segments[0] === "watch") return url.searchParams.get("v");
  if (segments.length === 2 && ["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) return segments[1] ?? null;
  return null;
}

function vimeoRef(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "player.vimeo.com") return segments.length === 2 && segments[0] === "video" ? segments[1] ?? null : null;
  // Unlisted videos ("/<id>/<hash>") are not supported: without the hash the player shows nothing.
  return segments.length === 1 ? segments[0] ?? null : null;
}

function spotifyRef(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  if (/^intl-[a-z]{2}$/.test(segments[0] ?? "") || segments[0] === "embed") segments.shift();
  return segments.length === 2 ? `${segments[0]}/${segments[1]}` : null;
}

/**
 * Reads a pasted address and returns the provider and resource id, or why it is refused. Only the
 * id survives: query strings, fragments, playlists, start times and redirect parameters are
 * dropped, so a "valid" address cannot carry anything else into the page.
 */
export function parseEmbedInput(input: string): EmbedParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "required" };
  // Embed code ("<iframe …>", "<script …>") is never accepted, not even to extract its address.
  if (/[<>]/.test(trimmed)) return { ok: false, reason: "markup" };
  const normalized = normalizeBlockUrl(trimmed);
  if (!normalized.ok || normalized.kind !== "web") return { ok: false, reason: "address" };
  const url = new URL(normalized.url);
  const provider = providerForHost(url.hostname);
  if (!provider) return { ok: false, reason: "unknown_provider" };
  const ref = provider === "youtube" ? youtubeRef(url) : provider === "vimeo" ? vimeoRef(url) : spotifyRef(url);
  return isValidEmbedRef(provider, ref) ? { ok: true, provider, ref } : { ok: false, reason: "unrecognized" };
}

/** Iframe address, or null when the pair is not valid (the renderer then shows nothing). */
export function embedFrameSrc(provider: EmbedProvider, ref: string, options: { autoplay?: boolean } = {}): string | null {
  if (!isValidEmbedRef(provider, ref)) return null;
  switch (provider) {
    case "youtube": return `https://www.youtube-nocookie.com/embed/${ref}${options.autoplay ? "?autoplay=1" : ""}`;
    case "vimeo": return `https://player.vimeo.com/video/${ref}?dnt=1${options.autoplay ? "&autoplay=1" : ""}`;
    case "spotify": return `https://open.spotify.com/embed/${ref}`;
  }
}

/** The provider's own page for the same resource: the no-JavaScript fallback of the facade. */
export function embedPageUrl(provider: EmbedProvider, ref: string): string | null {
  if (!isValidEmbedRef(provider, ref)) return null;
  switch (provider) {
    case "youtube": return `https://www.youtube.com/watch?v=${ref}`;
    case "vimeo": return `https://vimeo.com/${ref}`;
    case "spotify": return `https://open.spotify.com/${ref}`;
  }
}

export type EmbedLayout = { kind: "video" } | { kind: "audio"; height: 152 | 352 };

/** Space the player needs, reserved by the facade so loading it never shifts the layout. */
export function embedLayout(provider: EmbedProvider, ref: string): EmbedLayout {
  if (provider !== "spotify") return { kind: "video" };
  return { kind: "audio", height: /^(?:track|episode)\//.test(ref) ? 152 : 352 };
}

/** Fixed iframe attributes (ADR 0010). YouTube needs a referrer; only the origin is sent. */
export const EMBED_FRAME_ATTRIBUTES = {
  sandbox: "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox",
  allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
  referrerPolicy: "strict-origin-when-cross-origin",
  loading: "lazy",
} as const;
