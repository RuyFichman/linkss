/**
 * Narrow, vendor-neutral object storage port (ADR 0009). Supabase Storage is the only
 * implementation today; anything with put/remove/list and public URLs (Cloudflare R2, S3) fits.
 * Keys are opaque strings chosen by the caller and never reused for different content.
 */
export interface PutOptions {
  contentType: string;
  /** Seconds a client or CDN may cache the object. Keys are immutable, so this is long. */
  cacheSeconds: number;
}

export type PutOutcome = "created" | "exists";

export class StorageAdapterError extends Error {
  constructor(readonly operation: "put" | "remove" | "list", readonly code: string) {
    super(`Storage ${operation} failed: ${code}`);
    this.name = "StorageAdapterError";
  }
}

export interface StorageAdapter {
  /** Stores a new object. Never overwrites: an existing key answers "exists" and is left untouched. */
  put(key: string, body: Uint8Array, options: PutOptions): Promise<PutOutcome>;
  /** Removes objects. Missing keys are not an error, so cleanup can be repeated. */
  remove(keys: readonly string[]): Promise<void>;
  /** Keys that start with `prefix` (used by cleanup and audits; never by a page render). */
  list(prefix: string): Promise<string[]>;
  /** Address a browser can fetch without credentials. */
  publicUrl(key: string): string;
}
