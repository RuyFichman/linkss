import { GA_MEASUREMENT_ID_PATTERN, META_PIXEL_ID_PATTERN, type PublicPixels } from "./model";

/**
 * Loads the page owner's Meta Pixel and Google Analytics (ADR 0017). Runs in the visitor's
 * browser, only after consent. The product's own code: the only things taken from the owner are
 * two identifiers, checked again here, and the only scripts added are the two vendor libraries at
 * fixed addresses that the Content-Security-Policy of the public page allows.
 *
 * One page view is reported to each tool. No other event is sent by the product.
 */
export const META_PIXEL_SCRIPT = "https://connect.facebook.net/en_US/fbevents.js";
export const GA_SCRIPT = "https://www.googletagmanager.com/gtag/js";

/** The parts of `window` and `document` the loader touches, so it can be tested without a browser. */
export interface PixelHost {
  window: Record<string, unknown>;
  document: { createElement(tag: "script"): { async: boolean; src: string }; head: { appendChild(node: unknown): unknown } };
}

function addScript(host: PixelHost, src: string): void {
  const script = host.document.createElement("script");
  script.async = true;
  script.src = src;
  host.document.head.appendChild(script);
}

type Queue = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue: unknown[][]; loaded: boolean; version: string; push: unknown };

function loadMetaPixel(host: PixelHost, id: string): void {
  if (typeof host.window.fbq === "function") return;
  // The standard stub: calls are queued until the library loads and replays them.
  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  }) as Queue;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  host.window.fbq = fbq;
  host.window._fbq = fbq;
  addScript(host, META_PIXEL_SCRIPT);
  fbq("init", id);
  fbq("track", "PageView");
}

function loadGoogleAnalytics(host: PixelHost, id: string): void {
  if (Array.isArray(host.window.dataLayer)) return;
  const dataLayer: unknown[] = [];
  host.window.dataLayer = dataLayer;
  // gtag.js reads `arguments` objects from the queue, not arrays.
  const gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  } as (...args: unknown[]) => void;
  host.window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", id);
  addScript(host, `${GA_SCRIPT}?id=${encodeURIComponent(id)}`);
}

/** Idempotent per page load. Returns which tools were started. */
export function loadPixels(host: PixelHost, pixels: PublicPixels): Array<"meta" | "ga"> {
  const started: Array<"meta" | "ga"> = [];
  if (pixels.meta && META_PIXEL_ID_PATTERN.test(pixels.meta)) {
    loadMetaPixel(host, pixels.meta);
    started.push("meta");
  }
  if (pixels.ga && GA_MEASUREMENT_ID_PATTERN.test(pixels.ga)) {
    loadGoogleAnalytics(host, pixels.ga);
    started.push("ga");
  }
  return started;
}

/**
 * Consent is remembered per page and per set of identifiers, in the browser only: accepting one
 * owner's tools says nothing about another page, and a new identifier asks again.
 */
export function consentStorageKey(slug: string): string {
  return `lnk_pixel_consent:${slug}`;
}

export function consentFingerprint(pixels: PublicPixels): string {
  return `${pixels.meta ?? ""}|${pixels.ga ?? ""}`;
}

export type ConsentChoice = "granted" | "denied";

export function parseStoredConsent(stored: string | null, pixels: PublicPixels): ConsentChoice | null {
  if (!stored) return null;
  const separator = stored.indexOf(":");
  const choice = stored.slice(0, separator);
  if (separator < 0 || stored.slice(separator + 1) !== consentFingerprint(pixels)) return null;
  return choice === "granted" || choice === "denied" ? choice : null;
}

export function serializeConsent(choice: ConsentChoice, pixels: PublicPixels): string {
  return `${choice}:${consentFingerprint(pixels)}`;
}
