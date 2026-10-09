import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Timestamped webhook signature, in the scheme Stripe documents ("Verify webhook signatures
 * manually", read on 2026-10-09): the header is `t=<unix seconds>,v1=<hex>[,v1=<hex>…]`, the signed
 * text is `<t>.<raw body>` and the MAC is HMAC-SHA256 with the endpoint secret. Schemes other than
 * `v1` are ignored. Several `v1` values may be present while a secret is being rolled. The fake
 * adapter signs the same way, so one verifier is tested once.
 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type SignatureFailure = "missing_signature" | "bad_signature" | "stale_timestamp";

function mac(secret: string, timestamp: string, rawBody: string): Buffer {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
}

export function signWebhookPayload(rawBody: string, secret: string, at: Date): string {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  return `t=${timestamp},v1=${mac(secret, timestamp, rawBody).toString("hex")}`;
}

/** Returns null when the signature is valid and recent. Runs before the body is parsed. */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string, now: Date): SignatureFailure | null {
  if (!header || header.length > 1024) return "missing_signature";
  let timestamp: string | null = null;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = value;
    else if (key === "v1" && /^[0-9a-f]{64}$/.test(value)) candidates.push(value);
  }
  if (timestamp === null || candidates.length === 0) return "missing_signature";

  const expected = mac(secret, timestamp, rawBody);
  // Every candidate is compared, in constant time, before the timestamp is looked at.
  let matched = false;
  for (const candidate of candidates.slice(0, 5)) {
    if (timingSafeEqual(expected, Buffer.from(candidate, "hex"))) matched = true;
  }
  if (!matched) return "bad_signature";
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return "stale_timestamp";
  return null;
}
