import { createHmac } from "node:crypto";
import type { MediaKind } from "./policy";

/**
 * Upload attestation (ADR 0009). The server signs exactly what it validated and produced; the
 * database (private.media_signature_is_valid) recomputes the HMAC with the same secret from Vault
 * and refuses anything else. This is what tells an upload that went through validation from one
 * posted straight to the Storage API with a valid session. Mirror of private.media_register_payload.
 */
export interface AttestedVariant {
  width: number;
  height: number;
  bytes: number;
}

export interface RegisterAttestation {
  mediaId: string;
  profileId: string;
  kind: MediaKind;
  width: number;
  height: number;
  variants: readonly AttestedVariant[];
}

/** Canonical text that is signed: every value the database stores, variants ordered by width. */
export function registerPayload(input: RegisterAttestation): string {
  const variants = [...input.variants].sort((a, b) => a.width - b.width).map((variant) => `${variant.width}x${variant.height}x${variant.bytes}`).join(",");
  return `register:${input.mediaId}:${input.profileId}:${input.kind}:${input.width}x${input.height}:${variants}`;
}

export function activatePayload(mediaId: string): string {
  return `activate:${mediaId}`;
}

/** Lowercase hex HMAC-SHA256, the format the database compares against. */
export function signMediaPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** Minimum length accepted for the shared secret; a short value is treated as "not configured". */
export const MEDIA_SIGNING_SECRET_MIN_LENGTH = 32;

/** Signer bound to MEDIA_SIGNING_SECRET, or null when uploads are not configured in this environment. */
export function mediaSignerFromEnv(): ((payload: string) => string) | null {
  const secret = process.env.MEDIA_SIGNING_SECRET;
  if (!secret || secret.length < MEDIA_SIGNING_SECRET_MIN_LENGTH) return null;
  return (payload) => signMediaPayload(payload, secret);
}
