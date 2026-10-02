import { ANALYTICS_CONTRACT_VERSION, MAX_BATCH_EVENTS, type ClientEventType, type WireBatch } from "./contract";

/**
 * Public-page collector (ADR 0011). Runs only on `/[slug]`; the preview and the editor never start
 * it. Rules that must hold whatever happens:
 * - it never delays or cancels anything: listeners are passive, nothing is awaited and
 *   `preventDefault` is never called;
 * - every failure is swallowed: a page with this script broken works exactly like a page without it;
 * - it sets no cookie and stores nothing in the browser.
 * No React and no DOM globals here: everything comes through `CollectorEnvironment`, so the
 * behavior is unit-tested with fakes.
 */
export const ANALYTICS_ENDPOINT = "/api/events";
/** Events that keep the visitor on the page wait this long to travel together. */
export const BATCH_DELAY_MS = 1000;
export const RETRY_DELAY_MS = 2000;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;
const RAW_VALUE_MAX = 64;

/** The part of an element the collector reads. */
export interface ClickTarget {
  tagName: string;
  getAttribute(name: string): string | null;
  closest(selector: string): ClickTarget | null;
}

interface Listenable {
  addEventListener(type: string, listener: (event: Event) => void, options?: { capture?: boolean; passive?: boolean }): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: { capture?: boolean }): void;
}

export interface CollectorEnvironment {
  document: Listenable & { referrer: string; visibilityState: string; prerendering?: boolean };
  window: Listenable & {
    location: { pathname: string; search: string; origin: string };
    setTimeout(handler: () => void, delay: number): number;
    clearTimeout(handle: number | undefined): void;
  };
  navigator: { sendBeacon?: (url: string, body: string) => boolean; webdriver?: boolean };
  fetch?: (url: string, init: { method: string; body: string; keepalive: boolean; credentials: "same-origin"; headers: Record<string, string> }) => Promise<unknown>;
  randomId: () => string;
}

export interface ResolvedEvent {
  type: Exclude<ClientEventType, "page_view">;
  blockId: string | null;
  /** The click may unload the page, so the event has to leave now. */
  leaving: boolean;
}

/**
 * Which event a click means, read from the stable hooks the renderer writes (`data-block-id`,
 * `data-block-type`, ADR 0008/0010). Only real controls count: text, images, dividers and the
 * spans of the preview resolve to nothing. Form submissions are recorded by the server.
 */
export function eventForTarget(target: ClickTarget | null | undefined): ResolvedEvent | null {
  if (!target || typeof target.closest !== "function") return null;
  const control = target.closest("a,button");
  if (!control) return null;
  const isLink = control.tagName === "A";
  if (isLink && control.getAttribute("data-analytics") === "badge") return { type: "badge_click", blockId: null, leaving: true };
  const block = control.closest("[data-block-id]");
  const blockId = block?.getAttribute("data-block-id");
  if (!block || !blockId) return null;
  switch (block.getAttribute("data-block-type")) {
    case "link": return isLink ? { type: "link_click", blockId, leaving: true } : null;
    case "whatsapp": return isLink ? { type: "whatsapp_click", blockId, leaving: true } : null;
    case "social": return isLink ? { type: "social_click", blockId, leaving: true } : null;
    case "embed": return isLink ? { type: "embed_load", blockId, leaving: false } : null;
    case "pix": return isLink ? { type: "pix_pay_click", blockId, leaving: true } : { type: "pix_copy", blockId, leaving: false };
    default: return null;
  }
}

/** Host of the referrer (never its path or query) and whether it is one of the product's own app pages. */
export function referrerContext(referrer: string, origin: string): { host?: string; fromApp: boolean } {
  if (!referrer) return { fromApp: false };
  try {
    const url = new URL(referrer);
    // Android apps identify themselves as android-app://<package>; the scheme is what tells them apart.
    if (url.protocol === "android-app:") return { host: `android-app://${url.hostname}`, fromApp: false };
    const fromApp = url.origin === origin && (url.pathname === "/app" || url.pathname.startsWith("/app/"));
    return { host: url.hostname.slice(0, RAW_VALUE_MAX), fromApp };
  } catch {
    return { fromApp: false };
  }
}

export function utmContext(search: string): [string, string, string] | undefined {
  try {
    const params = new URLSearchParams(search);
    const values = UTM_KEYS.map((key) => (params.get(key) ?? "").slice(0, RAW_VALUE_MAX)) as [string, string, string];
    return values[0] ? values : undefined;
  } catch {
    return undefined;
  }
}

const NOOP = () => undefined;

/**
 * Starts collecting for one published page and returns a function that stops it. Returns a no-op
 * on app and prototype routes and under browser automation.
 */
export function startCollector(slug: string, env: CollectorEnvironment): () => void {
  try {
    const path = env.window.location.pathname;
    if (/^\/(app|proto)(\/|$)/.test(path) || env.navigator.webdriver === true) return NOOP;

    const referrer = referrerContext(env.document.referrer, env.window.location.origin);
    const utm = utmContext(env.window.location.search);
    let queue: WireBatch["e"] = [];
    let timer: number | null = null;
    let stopped = false;

    const send = (body: string, attempt: number): void => {
      try {
        if (env.navigator.sendBeacon?.(ANALYTICS_ENDPOINT, body)) return;
      } catch {
        // Fall through to fetch.
      }
      if (!env.fetch) return;
      try {
        // Only a network failure is retried, once, with the same event ids: the server stores an id
        // once, so a retry cannot double count.
        void env.fetch(ANALYTICS_ENDPOINT, { method: "POST", body, keepalive: true, credentials: "same-origin", headers: { "Content-Type": "text/plain;charset=UTF-8" } })
          .then(undefined, () => {
            if (attempt === 0 && !stopped) env.window.setTimeout(() => send(body, 1), RETRY_DELAY_MS);
          });
      } catch {
        // Analytics must never break the page.
      }
    };

    const flush = (): void => {
      if (timer !== null) {
        env.window.clearTimeout(timer);
        timer = null;
      }
      while (queue.length > 0) {
        const events = queue.slice(0, MAX_BATCH_EVENTS);
        queue = queue.slice(MAX_BATCH_EVENTS);
        const batch: WireBatch = { v: ANALYTICS_CONTRACT_VERSION, s: slug, e: events };
        if (referrer.host) batch.r = referrer.host;
        if (referrer.fromApp) batch.a = true;
        if (utm) batch.u = utm;
        send(JSON.stringify(batch), 0);
      }
    };

    const enqueue = (type: ClientEventType, blockId: string | null, urgent: boolean): void => {
      queue.push(blockId === null ? { i: env.randomId(), t: type } : { i: env.randomId(), t: type, b: blockId });
      if (urgent || queue.length >= MAX_BATCH_EVENTS) flush();
      else if (timer === null) timer = env.window.setTimeout(flush, BATCH_DELAY_MS);
    };

    const onClick = (event: Event): void => {
      try {
        // auxclick also fires for the right button; only the middle one opens a link.
        if (event.type === "auxclick" && (event as MouseEvent).button !== 1) return;
        const found = eventForTarget(event.target as unknown as ClickTarget | null);
        if (found) enqueue(found.type, found.blockId, found.leaving);
      } catch {
        // Analytics must never break the page.
      }
    };
    const onPageShow = (event: Event): void => {
      // Restored from the back/forward cache: the page is shown again without a new load.
      if ((event as PageTransitionEvent).persisted) enqueue("page_view", null, true);
    };
    const onHidden = (): void => {
      if (env.document.visibilityState === "hidden") flush();
    };
    const view = (): void => enqueue("page_view", null, true);

    const listen = { capture: true, passive: true } as const;
    env.document.addEventListener("click", onClick, listen);
    env.document.addEventListener("auxclick", onClick, listen);
    env.document.addEventListener("visibilitychange", onHidden);
    env.window.addEventListener("pagehide", flush);
    env.window.addEventListener("pageshow", onPageShow);

    // A prerendered page has not been seen yet; count it when it is activated.
    if (env.document.prerendering) env.document.addEventListener("prerenderingchange", view);
    else view();

    return () => {
      stopped = true;
      flush();
      env.document.removeEventListener("click", onClick, { capture: true });
      env.document.removeEventListener("auxclick", onClick, { capture: true });
      env.document.removeEventListener("visibilitychange", onHidden);
      env.document.removeEventListener("prerenderingchange", view);
      env.window.removeEventListener("pagehide", flush);
      env.window.removeEventListener("pageshow", onPageShow);
    };
  } catch {
    return NOOP;
  }
}

/** UUID v4 from the browser's secure random source; `randomUUID` only exists in secure contexts. */
export function browserRandomId(source: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string }): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
