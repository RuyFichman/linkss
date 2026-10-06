import "server-only";
import { createHash } from "node:crypto";

type RandomSource = (bytes: Uint8Array) => Uint8Array;

/**
 * 256 bits from the platform's cryptographic source, base64url (43 characters). Shown once to the
 * inviter; only its hash is stored (ADR 0012). Never log it.
 */
export function generateInvitationToken(random: RandomSource = (bytes) => crypto.getRandomValues(bytes)): string {
  return Buffer.from(random(new Uint8Array(32))).toString("base64url");
}

/** SHA-256, hex: the same value the database computes from a presented token. */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
