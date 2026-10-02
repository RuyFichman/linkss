/**
 * Device class and automated-traffic filter, both derived from the user agent on the server
 * (ADR 0011). The user agent itself is never stored. No dependency: the patterns are short, and
 * the table in `device-cases.ts` is the specification.
 */
export const DEVICE_CLASSES = ["mobile", "tablet", "desktop", "unknown"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export function isDeviceClass(value: unknown): value is DeviceClass {
  return typeof value === "string" && (DEVICE_CLASSES as readonly string[]).includes(value);
}

// Android without "Mobile" is a tablet by convention; iPadOS in desktop mode reports a Mac and is
// counted as desktop (known limit).
const TABLET = /ipad|tablet|kindle|silk\/|playbook|\bsm-t\d|android(?!.*mobi)/i;
const MOBILE = /mobi|iphone|ipod|windows phone|iemobile|opera mini/i;
const DESKTOP = /windows nt|macintosh|x11|linux|cros/i;

export function classifyDevice(userAgent: string | null | undefined): DeviceClass {
  const text = userAgent ?? "";
  if (TABLET.test(text)) return "tablet";
  if (MOBILE.test(text)) return "mobile";
  if (DESKTOP.test(text)) return "desktop";
  return "unknown";
}

const BOT_PATTERNS = [
  // Generic crawlers. "Cubot" is a phone brand, not a bot.
  /(?<!cu)bot\b/i, /crawl/i, /spider/i, /slurp/i,
  // Link-preview fetchers: they load the page to build a card, nobody is looking at it.
  /facebookexternalhit/i, /facebot/i, /meta-external/i, /^whatsapp\//i, /skypeuripreview/i, /embedly/i, /vkshare/i, /link ?preview/i, /google-pagerenderer/i,
  // Headless browsers and automation.
  /headlesschrome/i, /phantomjs/i, /puppeteer/i, /playwright/i, /selenium/i, /webdriver/i, /electron/i,
  // Performance tools and monitors.
  /lighthouse/i, /pagespeed/i, /gtmetrix/i, /\bptst\b/i, /pingdom/i, /uptime/i, /statuscake/i, /site24x7/i, /datadog/i, /newrelic/i,
  // HTTP libraries and command-line clients.
  /^curl\//i, /^wget\//i, /python-requests/i, /python-urllib/i, /aiohttp/i, /httpx/i, /go-http-client/i, /node-fetch/i, /undici/i, /^node\b/i, /axios/i, /okhttp/i, /^java\//i, /libwww/i, /httpclient/i, /scrapy/i, /postmanruntime/i, /insomnia/i,
];

/** True for an empty user agent and for known bots, preview fetchers, automation and tools. */
export function isAutomatedUserAgent(userAgent: string | null | undefined): boolean {
  const text = (userAgent ?? "").trim();
  return text === "" || BOT_PATTERNS.some((pattern) => pattern.test(text));
}

/** ISO 3166-1 alpha-2 from the hosting platform's header, or "ZZ" when it is absent or malformed. */
export const UNKNOWN_COUNTRY = "ZZ";

export function normalizeCountry(value: string | null | undefined): string {
  const text = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : UNKNOWN_COUNTRY;
}
