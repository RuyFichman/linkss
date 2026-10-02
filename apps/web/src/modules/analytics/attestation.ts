import { createHmac } from "node:crypto";
import { ANALYTICS_CONTRACT_VERSION, type ClientEvent } from "./contract";
import type { DeviceClass } from "./device";
import type { TrafficSource, UtmValues } from "./sources";

/**
 * Ingestion attestation (ADR 0011). The Route Handler signs the exact text it sends to
 * public.ingest_analytics_events; the database recomputes the HMAC with the same secret from Vault
 * (private.analytics_signature_is_valid). A direct call to the RPC with only the publishable key
 * has no valid signature, so the visitor hash and the server-derived dimensions cannot be forged.
 * The secret attests; it grants no access to data.
 */
export const ANALYTICS_SIGNING_SECRET_MIN_LENGTH = 32;

export interface IngestPayload {
  slug: string;
  visitor: string | null;
  /** Address-only hash for the limit across pages; kept in the rate-limit counters, never on events. */
  client: string | null;
  /** Dimensions of the visit; stored on page views only. */
  view: { source: TrafficSource; device: DeviceClass; country: string; utm: UtmValues };
  events: readonly ClientEvent[];
}

/** The signed text. Key order is fixed so the same batch always serializes the same way. */
export function serializeIngestPayload(payload: IngestPayload): string {
  return JSON.stringify({
    v: ANALYTICS_CONTRACT_VERSION,
    slug: payload.slug,
    visitor: payload.visitor,
    client: payload.client,
    view: {
      source: payload.view.source,
      device: payload.view.device,
      country: payload.view.country,
      utm_source: payload.view.utm.source,
      utm_medium: payload.view.utm.medium,
      utm_campaign: payload.view.utm.campaign,
    },
    events: payload.events.map((event) => ({ id: event.id, type: event.type, block: event.blockId })),
  });
}

export function signIngestPayload(text: string, secret: string): string {
  return createHmac("sha256", secret).update(text, "utf8").digest("hex");
}

/** The signing secret of this environment, or null when ingestion is not configured. */
export function analyticsSigningSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.ANALYTICS_SIGNING_SECRET ?? "";
  return secret.length >= ANALYTICS_SIGNING_SECRET_MIN_LENGTH ? secret : null;
}
