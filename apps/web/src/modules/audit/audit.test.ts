import { describe, expect, it } from "vitest";
import { correlationIdFrom, sanitizeLogFields } from "@/lib/observability/logger";
import { redactAuditMetadata } from "./redaction";

describe("audit metadata redaction", () => {
  it("keeps only allowlisted short strings", () => {
    expect(redactAuditMetadata({ method: "password", correlation_id: "c-123", email: "ana@example.com", token: "abc", password: "x", ip: "10.0.0.1" })).toEqual({ method: "password", correlation_id: "c-123" });
  });

  it("drops allowlisted keys whose values look sensitive or are too long", () => {
    expect(redactAuditMetadata({ method: "ana@example.com" })).toEqual({});
    expect(redactAuditMetadata({ method: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" })).toEqual({});
    expect(redactAuditMetadata({ method: "sb_secret_abc" })).toEqual({});
    expect(redactAuditMetadata({ correlation_id: "192.168.0.10" })).toEqual({});
    expect(redactAuditMetadata({ method: "x".repeat(65) })).toEqual({});
    expect(redactAuditMetadata({ method: 42 })).toEqual({});
  });
});

describe("structured log sanitization", () => {
  it("drops sensitive keys and masks email-like values", () => {
    expect(sanitizeLogFields({ event: "x", email: "ana@example.com", password: "p", token_hash: "t", cookie: "c", path: "/app", note: "falha para ana@example.com" }))
      .toEqual({ event: "x", path: "/app", note: "falha para [redacted-email]" });
  });

  it("keeps error codes but drops auth codes (regression)", () => {
    expect(sanitizeLogFields({ errorCode: "LK010", code: "pkce-auth-code", apikey: "sb_publishable_x" })).toEqual({ errorCode: "LK010" });
  });

  it("accepts well-formed correlation ids and replaces anything else", () => {
    expect(correlationIdFrom("abcd-1234-efgh")).toBe("abcd-1234-efgh");
    expect(correlationIdFrom("<script>")).toMatch(/^[0-9a-f-]{36}$/);
    expect(correlationIdFrom(null)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
