import type { BlockType } from "@/modules/blocks/model";

/**
 * Customer-analytics event contract, version 1 (ADR 0011). Source of truth for the collector, the
 * ingestion Route Handler and the dashboard; `public.analytics_event_type` and
 * `public.ingest_analytics_events` mirror it. Imported by the public page's client bundle, so it
 * must stay free of server code and of user-facing copy.
 */
export const ANALYTICS_CONTRACT_VERSION = 1;

export const ANALYTICS_EVENT_TYPES = [
  "page_view", "link_click", "social_click", "embed_load", "whatsapp_click", "pix_copy", "pix_pay_click", "form_submit", "badge_click",
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

/** `form_submit` is recorded by the database when a lead is stored; a browser can never send it. */
export const CLIENT_EVENT_TYPES = ANALYTICS_EVENT_TYPES.filter((type) => type !== "form_submit");
export type ClientEventType = Exclude<AnalyticsEventType, "form_submit">;

/** Actions of value for the funnel ("resultados", UX-043, provisional). */
export const VALUE_ACTION_TYPES = ["whatsapp_click", "pix_copy", "pix_pay_click", "form_submit"] as const satisfies readonly AnalyticsEventType[];
/** Every interaction with a block that the owner sees: navigation, engagement and actions of value. */
export const INTERACTION_TYPES = ["link_click", "social_click", "embed_load", ...VALUE_ACTION_TYPES] as const satisfies readonly AnalyticsEventType[];

/** Block type an event must point at; `null` for page-level events (mirror of private.analytics_event_block_type). */
export const EVENT_BLOCK_TYPE: Record<AnalyticsEventType, BlockType | null> = {
  page_view: null,
  link_click: "link",
  social_click: "social",
  embed_load: "embed",
  whatsapp_click: "whatsapp",
  pix_copy: "pix",
  pix_pay_click: "pix",
  form_submit: "form",
  badge_click: null,
};

export const MAX_BATCH_EVENTS = 10;
/** Largest request body the ingestion endpoint reads, in bytes. */
export const MAX_REQUEST_BYTES = 4096;
/** Characters of a referrer host or UTM value the server is willing to look at before normalizing. */
export const MAX_RAW_VALUE_LENGTH = 255;

/** Id of the social row of a schema-version-1 snapshot (modules/publishing/document.ts). */
export const LEGACY_SOCIAL_BLOCK_ID = "legacy-social";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isAnalyticsEventType(value: unknown): value is AnalyticsEventType {
  return typeof value === "string" && (ANALYTICS_EVENT_TYPES as readonly string[]).includes(value);
}

function isClientEventType(value: unknown): value is ClientEventType {
  return isAnalyticsEventType(value) && value !== "form_submit";
}

export function isValueAction(type: AnalyticsEventType): boolean {
  return (VALUE_ACTION_TYPES as readonly string[]).includes(type);
}

/**
 * Batch as the collector sends it. Short keys keep the beacon small:
 * `v` version, `s` page address, `r` referrer host, `a` referrer is the product's own app,
 * `u` [utm_source, utm_medium, utm_campaign], `e` events as {i: id, t: type, b: block id}.
 */
export interface WireBatch {
  v: number;
  s: string;
  r?: string;
  a?: boolean;
  u?: [string, string, string];
  e: Array<{ i: string; t: string; b?: string }>;
}

export interface ClientEvent {
  id: string;
  type: ClientEventType;
  blockId: string | null;
}

export interface ClientBatch {
  slug: string;
  /** As sent; classified and discarded by the server, never stored. */
  referrer: string | null;
  fromApp: boolean;
  /** Raw UTM values, not yet normalized. */
  utm: { source: string | null; medium: string | null; campaign: string | null };
  events: ClientEvent[];
  /** Events of the batch that were dropped as malformed. */
  dropped: number;
}

function rawText(value: unknown): string | null {
  return typeof value === "string" && value !== "" && value.length <= MAX_RAW_VALUE_LENGTH ? value : null;
}

function parseEvent(value: unknown): ClientEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (typeof event.i !== "string" || !UUID_PATTERN.test(event.i) || !isClientEventType(event.t)) return null;
  const expected = EVENT_BLOCK_TYPE[event.t];
  if (expected === null) return event.b === undefined ? { id: event.i, type: event.t, blockId: null } : null;
  if (typeof event.b !== "string") return null;
  const legacySocial = event.t === "social_click" && event.b === LEGACY_SOCIAL_BLOCK_ID;
  return UUID_PATTERN.test(event.b) || legacySocial ? { id: event.i, type: event.t, blockId: event.b } : null;
}

/**
 * Validates and normalizes an untrusted batch at the boundary. Returns null when the envelope is
 * unusable (wrong version, bad address, no event list); malformed events inside a good envelope are
 * dropped one by one. Unknown keys are ignored, so a later contract version can add fields.
 */
export function parseClientBatch(input: unknown): ClientBatch | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const batch = input as Record<string, unknown>;
  if (batch.v !== ANALYTICS_CONTRACT_VERSION) return null;
  if (typeof batch.s !== "string" || batch.s.length > 40 || !SLUG_PATTERN.test(batch.s)) return null;
  if (!Array.isArray(batch.e) || batch.e.length === 0 || batch.e.length > MAX_BATCH_EVENTS) return null;

  const seen = new Set<string>();
  const events: ClientEvent[] = [];
  for (const item of batch.e) {
    const event = parseEvent(item);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  const utm = Array.isArray(batch.u) ? batch.u : [];
  return {
    slug: batch.s,
    referrer: rawText(batch.r),
    fromApp: batch.a === true,
    utm: { source: rawText(utm[0]), medium: rawText(utm[1]), campaign: rawText(utm[2]) },
    events,
    dropped: batch.e.length - events.length,
  };
}
