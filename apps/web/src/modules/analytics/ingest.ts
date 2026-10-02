import { serializeIngestPayload, signIngestPayload } from "./attestation";
import { MAX_REQUEST_BYTES, parseClientBatch } from "./contract";
import { classifyDevice, isAutomatedUserAgent, normalizeCountry } from "./device";
import { classifySource, normalizeUtm } from "./sources";
import { analyticsVisitorHash } from "./visitor-hash";

/**
 * Ingestion boundary (ADR 0011): turns one untrusted request into either a reason to drop it or a
 * signed payload for public.ingest_analytics_events. Pure: the Route Handler reads the headers and
 * the environment and passes them in. Nothing here is stored or logged except the outcome.
 */
export interface IngestInput {
  /** Request body as text. */
  body: string;
  userAgent: string | null;
  /** Client address as seen by the hosting platform; only hashed. */
  ip: string | null;
  /** Country header of the hosting platform, when present. */
  country: string | null;
  /** The request carries a session cookie of the product: somebody signed in, not a visitor. */
  signedIn: boolean;
  /** Host of the product itself, so a visit that came from one of its own pages is "direct". */
  ownHost: string | null;
  /** Reporting day of the request (`YYYY-MM-DD`). */
  day: string;
  salt: string | null | undefined;
  signingSecret: string | null;
}

export type IngestDropReason = "invalid" | "automated" | "signed_in" | "app_referrer" | "empty" | "not_configured";

export type PreparedIngestion =
  | { send: false; reason: IngestDropReason }
  | { send: true; payload: string; signature: string; events: number; dropped: number; hashed: boolean };

export function prepareIngestion(input: IngestInput): PreparedIngestion {
  if (new TextEncoder().encode(input.body).length > MAX_REQUEST_BYTES) return { send: false, reason: "invalid" };
  let json: unknown;
  try {
    json = JSON.parse(input.body);
  } catch {
    return { send: false, reason: "invalid" };
  }
  const batch = parseClientBatch(json);
  if (!batch) return { send: false, reason: "invalid" };

  // Filtered traffic is dropped, not stored with a flag.
  if (isAutomatedUserAgent(input.userAgent)) return { send: false, reason: "automated" };
  if (input.signedIn) return { send: false, reason: "signed_in" };
  if (batch.fromApp) return { send: false, reason: "app_referrer" };
  if (batch.events.length === 0) return { send: false, reason: "empty" };
  if (!input.signingSecret) return { send: false, reason: "not_configured" };

  const utm = normalizeUtm(batch.utm);
  const visitor = analyticsVisitorHash({ ip: input.ip, userAgent: input.userAgent, slug: batch.slug, day: input.day, salt: input.salt });
  const payload = serializeIngestPayload({
    slug: batch.slug,
    visitor,
    view: {
      // The referrer is used here and discarded: only its class leaves this function.
      source: classifySource(batch.referrer, utm.source, input.ownHost),
      device: classifyDevice(input.userAgent),
      country: normalizeCountry(input.country),
      utm,
    },
    events: batch.events,
  });
  return { send: true, payload, signature: signIngestPayload(payload, input.signingSecret), events: batch.events.length, dropped: batch.dropped, hashed: visitor !== null };
}

/** Statuses of public.ingest_analytics_events(), plus the two the application adds. */
export type IngestStatus = "ok" | "not_configured" | "forbidden" | "invalid" | "unsupported" | "unavailable" | "not_deployed";

export interface IngestOutcome {
  status: IngestStatus;
  accepted: number;
  duplicate: number;
  repeat: number;
  rejected: number;
  rateLimited: number;
}

const STATUSES: readonly string[] = ["ok", "not_configured", "forbidden", "invalid", "unsupported", "unavailable"];

function counter(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Reads the RPC's answer; anything unexpected counts as "unavailable". */
export function parseIngestOutcome(value: unknown): IngestOutcome {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const status = typeof row.status === "string" && STATUSES.includes(row.status) ? (row.status as IngestStatus) : "unavailable";
  return { status, accepted: counter(row.accepted), duplicate: counter(row.duplicate), repeat: counter(row.repeat), rejected: counter(row.rejected), rateLimited: counter(row.rate_limited) };
}

export interface IngestRepository {
  /** Calls the RPC. Throws on timeout or transport failure. */
  ingest(payload: string, signature: string): Promise<IngestOutcome>;
}

const EMPTY: Omit<IngestOutcome, "status"> = { accepted: 0, duplicate: 0, repeat: 0, rejected: 0, rateLimited: 0 };

/** Delivers a prepared batch. Never throws: a database that is slow or down only loses the batch. */
export async function deliverIngestion(repository: IngestRepository, prepared: Extract<PreparedIngestion, { send: true }>): Promise<IngestOutcome> {
  try {
    return await repository.ingest(prepared.payload, prepared.signature);
  } catch {
    return { status: "unavailable", ...EMPTY };
  }
}

/** A session cookie of Supabase Auth (`sb-<ref>-auth-token`, possibly split in numbered chunks). */
export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  return /(?:^|;\s*)sb-[^=;\s]+-auth-token(?:\.\d+)?=/.test(cookieHeader ?? "");
}
