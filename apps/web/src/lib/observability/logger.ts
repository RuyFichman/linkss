// Structured JSON logs (docs/OBSERVABILITY.md). Never pass emails, tokens, passwords or cookies:
// sensitive keys are dropped and email-like values masked as a second line of defense.
export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export const CORRELATION_HEADER = "x-correlation-id";
// `code` alone is the PKCE auth code; `errorCode` (a Postgres/Auth error code) must survive.
const SENSITIVE_KEY = /pass(word)?|token|secret|cookie|authorization|email|api_?key|session|otp|^code$/i;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+/g;

export function sanitizeLogFields(fields: LogFields): LogFields {
  const clean: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SENSITIVE_KEY.test(key)) continue;
    clean[key] = typeof value === "string" ? value.replace(EMAIL_LIKE, "[redacted-email]").slice(0, 200) : value;
  }
  return clean;
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), service: "lnk-web", ...sanitizeLogFields(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

const CORRELATION_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;

/** Accepts a well-formed incoming correlation ID or creates a new one. */
export function correlationIdFrom(value: string | null | undefined): string {
  return value && CORRELATION_PATTERN.test(value) ? value : crypto.randomUUID();
}
