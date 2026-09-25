import type { Database } from "@/lib/database.types";

export type AuditAction = Database["public"]["Enums"]["audit_action"];
export type AuditMetadata = Record<string, string>;

/** Keys the server may attach to authentication events; mirrors public.record_auth_event. */
export const AUDIT_METADATA_ALLOWLIST = ["method", "correlation_id"] as const;
export const AUDIT_VALUE_MAX_LENGTH = 64;

const SENSITIVE_VALUE = /@|bearer\s|eyJ[a-z0-9_-]{10,}|sb_(secret|publishable)_|\b\d{1,3}(\.\d{1,3}){3}\b/i;

/**
 * Keeps only allowlisted keys with short string values that do not look like emails, tokens, keys
 * or IP addresses. The database applies the same allowlist again.
 */
export function redactAuditMetadata(input: Readonly<Record<string, unknown>>): AuditMetadata {
  const output: AuditMetadata = {};
  for (const key of AUDIT_METADATA_ALLOWLIST) {
    const value = input[key];
    if (typeof value !== "string" || value.length === 0 || value.length > AUDIT_VALUE_MAX_LENGTH) continue;
    if (SENSITIVE_VALUE.test(value)) continue;
    output[key] = value;
  }
  return output;
}
