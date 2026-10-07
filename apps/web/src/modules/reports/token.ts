import "server-only";
import { createHash, createHmac } from "node:crypto";

type RandomSource = (bytes: Uint8Array) => Uint8Array;

/**
 * 256 bits from the platform's cryptographic source, base64url (43 characters). Shown once to the
 * person who created the link; only its hash is stored (ADR 0013). Never log it.
 */
export function generateReportToken(random: RandomSource = (bytes) => crypto.getRandomValues(bytes)): string {
  return Buffer.from(random(new Uint8Array(32))).toString("base64url");
}

/** SHA-256, hex: the same value the database computes from a presented token. */
export function hashReportToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const SALT_MIN_LENGTH = 16;

/**
 * Key of the failed-lookup limit (ADR 0013): a salted hash of the address that changes every UTC
 * day. The address itself never reaches the database, and the value cannot be matched with the
 * analytics or lead hashes (same salt, different message prefix). Null when there is no usable
 * address or salt; the database then counts the caller in a shared bucket.
 */
export function reportClientHash(ip: string | null | undefined, salt: string | null | undefined, now: Date = new Date()): string | null {
  const address = (ip ?? "").trim();
  if (!address || !salt || salt.length < SALT_MIN_LENGTH) return null;
  return createHmac("sha256", salt).update(["report:v1", now.toISOString().slice(0, 10), address].join("\u001f"), "utf8").digest("hex").slice(0, 32);
}
