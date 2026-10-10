import { describe, expect, it } from "vitest";
import { normalizeReportDetail, serializeReport, signReport, type ReportPayload } from "./contract";

describe("public abuse report contract", () => {
  it("normalizes optional details and rejects short or oversized input", () => {
    expect(normalizeReportDetail("  linha um\nlinha dois  ")).toBe("linha um linha dois");
    expect(normalizeReportDetail(" ")).toBe("");
    expect(normalizeReportDetail("curto")).toBeNull();
    expect(normalizeReportDetail("x".repeat(501))).toBeNull();
    expect(normalizeReportDetail({})).toBeNull();
  });

  it("serializes every server-controlled field in a stable order for HMAC verification", () => {
    const payload: ReportPayload = {
      v: 1,
      slug: "pagina-exemplo",
      reason: "phishing",
      detail: "Relato com contexto suficiente",
      hash: "0123456789abcdef0123456789abcdef",
      at: "2026-10-09T12:00:00.000Z",
    };
    expect(serializeReport(payload)).toBe('{"v":1,"slug":"pagina-exemplo","reason":"phishing","detail":"Relato com contexto suficiente","hash":"0123456789abcdef0123456789abcdef","at":"2026-10-09T12:00:00.000Z"}');
    expect(signReport(serializeReport(payload), "test-moderation-secret-0123456789-abcdef"))
      .toBe("ad631f399f2fd7bbdf0b1a9b74afef2daf2475a8b9532c5f804bc163ba836196");
  });
});
