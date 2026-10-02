import { describe, expect, it, vi } from "vitest";
import type { IdentityPort } from "@/modules/identity/guard";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import { createLeadsService, createLeadSubmissionService, csvCell, leadsToCsv, type Lead, type LeadsRepository, type LeadSubmissionRepository } from "./service";
import { normalizeLeadField, validateSubmission, type FormDefinition } from "./submission";
import { clientAddress, visitorHash } from "./visitor-hash";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const PAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BLOCK = "6f1c1d2e-0000-4000-8000-000000000001";
const LEAD = "7b000000-0000-4000-8000-000000000001";

const FORM: FormDefinition = { fields: ["name", "email", "phone", "message"], consentRequired: true };
const valid = { values: { name: " Ana   Lima ", email: " Ana@Exemplo.COM.br ", phone: "(11) 91234-5678", message: " Quero um\r\norçamento " }, consent: true, honeypot: "" };

describe("form submission validation (mirror of public.submit_form_lead)", () => {
  it("normalizes every field", () => {
    expect(validateSubmission(FORM, valid)).toEqual({ ok: true, consent: true, values: { name: "Ana Lima", email: "ana@exemplo.com.br", phone: "11912345678", message: "Quero um\norçamento" } });
    expect(normalizeLeadField("phone", "+55 11 91234-5678")).toEqual({ ok: true, value: "+5511912345678" });
    expect(normalizeLeadField("message", "")).toEqual({ ok: true, value: "" });
  });

  it("reads only the fields the published form has", () => {
    const result = validateSubmission({ fields: ["email"], consentRequired: false }, { values: { name: "Ana", email: "ana@exemplo.com.br", phone: "x", message: "<script>" }, consent: false, honeypot: "" });
    expect(result).toEqual({ ok: true, consent: false, values: { email: "ana@exemplo.com.br" } });
  });

  it("reports each invalid field", () => {
    const result = validateSubmission(FORM, { values: { name: "", email: "ana@", phone: "12", message: "x".repeat(1001) }, consent: true, honeypot: "" });
    expect(result).toEqual({ ok: false, reason: "invalid", problems: { name: "required", email: "invalid", phone: "invalid", message: "too_long" } });
    expect(normalizeLeadField("name", "x".repeat(101))).toEqual({ ok: false, problem: "too_long" });
    expect(normalizeLeadField("name", "Ana\u0007")).toEqual({ ok: false, problem: "invalid" });
    expect(normalizeLeadField("phone", "ligue 11 91234-5678")).toEqual({ ok: false, problem: "invalid" });
    expect(normalizeLeadField("email", 42)).toEqual({ ok: false, problem: "required" });
    expect(normalizeLeadField("email", "ana lima@exemplo.com.br")).toEqual({ ok: false, problem: "invalid" });
  });

  it("requires consent only when the owner made it required", () => {
    expect(validateSubmission(FORM, { ...valid, consent: false })).toEqual({ ok: false, reason: "consent_required" });
    expect(validateSubmission({ ...FORM, consentRequired: false }, { ...valid, consent: false })).toMatchObject({ ok: true, consent: false });
  });

  it("treats a filled honeypot as automated before looking at anything else", () => {
    expect(validateSubmission(FORM, { values: {}, consent: false, honeypot: "https://spam.example" })).toEqual({ ok: false, reason: "honeypot" });
    expect(validateSubmission(FORM, { ...valid, honeypot: "   " })).toMatchObject({ ok: true });
  });
});

describe("visitor hash for the rate limit", () => {
  const SALT = "0123456789abcdef0123456789abcdef";
  const day = new Date("2026-10-01T15:00:00Z");

  it("is stable within a day, rotates daily and depends on the secret salt", () => {
    const hash = visitorHash("203.0.113.7", SALT, day);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorHash("203.0.113.7", SALT, new Date("2026-10-01T23:59:59Z"))).toBe(hash);
    expect(visitorHash("203.0.113.7", SALT, new Date("2026-10-02T00:00:01Z"))).not.toBe(hash);
    expect(visitorHash("203.0.113.8", SALT, day)).not.toBe(hash);
    expect(visitorHash("203.0.113.7", `${SALT}x`, day)).not.toBe(hash);
    expect(hash).not.toContain("203");
  });

  it("gives no identifier without an address or a real salt", () => {
    expect(visitorHash(null, SALT, day)).toBeNull();
    expect(visitorHash("  ", SALT, day)).toBeNull();
    expect(visitorHash("203.0.113.7", "", day)).toBeNull();
    expect(visitorHash("203.0.113.7", "short", day)).toBeNull();
    expect(clientAddress("203.0.113.7, 10.0.0.1", null)).toBe("203.0.113.7");
    expect(clientAddress(null, "198.51.100.2")).toBe("198.51.100.2");
    expect(clientAddress("", null)).toBeNull();
  });
});

function submissionRepository(overrides: Partial<LeadSubmissionRepository> = {}): LeadSubmissionRepository {
  return { findPublishedForm: vi.fn(async () => FORM), submit: vi.fn(async () => "ok" as const), ...overrides };
}

describe("lead submission command", () => {
  const dependencies = { clientHash: () => "hash-of-the-visitor" };

  it("stores a valid submission with normalized values and the visitor hash", async () => {
    const repository = submissionRepository();
    expect(await createLeadSubmissionService(repository, dependencies).submit("ana-lima", BLOCK, valid)).toEqual({ status: "ok" });
    expect(repository.submit).toHaveBeenCalledWith({ slug: "ana-lima", blockId: BLOCK, consent: true, honeypot: "", clientHash: "hash-of-the-visitor", values: { name: "Ana Lima", email: "ana@exemplo.com.br", phone: "11912345678", message: "Quero um\norçamento" } });
  });

  it("answers ok to a filled honeypot without storing or even looking the form up", async () => {
    const repository = submissionRepository();
    expect(await createLeadSubmissionService(repository, dependencies).submit("ana-lima", BLOCK, { ...valid, honeypot: "http://spam.example" })).toEqual({ status: "ok" });
    expect(repository.findPublishedForm).not.toHaveBeenCalled();
    expect(repository.submit).not.toHaveBeenCalled();
  });

  it("rejects missing consent and invalid fields before the database", async () => {
    const repository = submissionRepository();
    const service = createLeadSubmissionService(repository, dependencies);
    expect(await service.submit("ana-lima", BLOCK, { ...valid, consent: false })).toEqual({ status: "consent_required" });
    expect(await service.submit("ana-lima", BLOCK, { ...valid, values: { ...valid.values, email: "x" } })).toEqual({ status: "invalid", problems: { email: "invalid" } });
    expect(repository.submit).not.toHaveBeenCalled();
  });

  it("passes the database's decision through: rate limit, consent, unavailable", async () => {
    for (const status of ["rate_limited", "consent_required", "invalid", "unavailable"] as const) {
      const repository = submissionRepository({ submit: vi.fn(async () => status) });
      expect(await createLeadSubmissionService(repository, dependencies).submit("ana-lima", BLOCK, valid)).toEqual({ status });
    }
  });

  it("is safe to retry: the same submission is sent again as is", async () => {
    const repository = submissionRepository();
    const service = createLeadSubmissionService(repository, dependencies);
    await service.submit("ana-lima", BLOCK, valid);
    await service.submit("ana-lima", BLOCK, valid);
    const calls = vi.mocked(repository.submit).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
  });

  it("is unavailable for a form that is not published, a forged address or a lookup failure", async () => {
    const missing = submissionRepository({ findPublishedForm: vi.fn(async () => null) });
    expect(await createLeadSubmissionService(missing, dependencies).submit("ana-lima", BLOCK, valid)).toEqual({ status: "unavailable" });
    const repository = submissionRepository();
    const service = createLeadSubmissionService(repository, dependencies);
    expect(await service.submit("../etc/passwd", BLOCK, valid)).toEqual({ status: "unavailable" });
    expect(await service.submit("ana-lima", "not-a-uuid", valid)).toEqual({ status: "unavailable" });
    expect(await service.submit(undefined, BLOCK, valid)).toEqual({ status: "unavailable" });
    expect(repository.findPublishedForm).not.toHaveBeenCalled();
    const failing = submissionRepository({ submit: vi.fn(async () => { throw new Error("timeout"); }) });
    expect(await createLeadSubmissionService(failing, dependencies).submit("ana-lima", BLOCK, valid)).toEqual({ status: "unavailable" });
  });
});

function identity(userId: string | null, roles: Record<string, WorkspaceRole>): IdentityPort {
  return { currentUserId: async () => userId, roleIn: async (_user, workspaceId) => roles[workspaceId] ?? null };
}

const lead: Lead = { id: LEAD, blockId: BLOCK, values: { name: "Ana", email: "ana@exemplo.com.br" }, consentGiven: true, consentText: "Aceito.", consentedAt: "2026-10-01T12:00:00Z", createdAt: "2026-10-01T12:00:00Z", purgeAfter: "2026-12-30T12:00:00Z" };

function leadsRepository(visibleWorkspaces: string[]): LeadsRepository {
  const pages = [{ id: PAGE_A, workspaceId: WS_A }, { id: PAGE_B, workspaceId: WS_B }];
  return {
    findProfile: vi.fn(async (id: string) => pages.find((page) => page.id === id && visibleWorkspaces.includes(page.workspaceId)) ?? null),
    list: vi.fn(async () => ({ leads: [lead], total: 1 })),
    remove: vi.fn(async () => ({ ok: true as const })),
    recordExport: vi.fn(async () => ({ ok: true as const })),
  };
}

describe("leads commands: server-side authorization", () => {
  it("lets every role of the workspace read, and only owners and admins delete or export", async () => {
    for (const role of ["owner", "admin", "editor"] as const) {
      const repository = leadsRepository([WS_A]);
      const service = createLeadsService(identity("u1", { [WS_A]: role }), repository);
      expect(await service.list(PAGE_A)).toEqual({ ok: true, value: { leads: [lead], total: 1 } });
      const allowed = role !== "editor";
      expect((await service.remove(PAGE_A, LEAD)).ok).toBe(allowed);
      expect((await service.exportCsv(PAGE_A)).ok).toBe(allowed);
      expect(vi.mocked(repository.remove).mock.calls.length).toBe(allowed ? 1 : 0);
      expect(vi.mocked(repository.recordExport).mock.calls.length).toBe(allowed ? 1 : 0);
    }
  });

  it("treats another tenant's page as not found and rejects anonymous callers", async () => {
    const repository = leadsRepository([WS_A]);
    const service = createLeadsService(identity("u1", { [WS_A]: "owner" }), repository);
    expect(await service.list(PAGE_B)).toEqual({ ok: false, error: "not_found" });
    expect(await service.remove(PAGE_B, LEAD)).toEqual({ ok: false, error: "not_found" });
    expect(await service.exportCsv(PAGE_B)).toEqual({ ok: false, error: "not_found" });
    expect(await service.remove(PAGE_A, "../x")).toEqual({ ok: false, error: "not_found" });
    expect(await createLeadsService(identity(null, {}), repository).list(PAGE_A)).toEqual({ ok: false, error: "unauthenticated" });
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it("does not hand over the file when the export could not be audited", async () => {
    const repository = leadsRepository([WS_A]);
    repository.recordExport = vi.fn(async () => ({ ok: false as const, error: "unavailable" as const }));
    expect(await createLeadsService(identity("u1", { [WS_A]: "owner" }), repository).exportCsv(PAGE_A)).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("CSV export", () => {
  it("quotes every cell and defuses spreadsheet formulas", () => {
    expect(csvCell('Ana "Aninha" Lima')).toBe('"Ana ""Aninha"" Lima"');
    expect(csvCell("=HYPERLINK(\"https://evil.example\")")).toBe('"\'=HYPERLINK(""https://evil.example"")"');
    for (const value of ["+55 11 91234-5678", "-1+1", "@SUM(A1)", "\tx"]) expect(csvCell(value).startsWith("\"'")).toBe(true);
    const csv = leadsToCsv([lead, { ...lead, values: { phone: "+5511912345678", message: "linha 1\nlinha 2" }, consentGiven: false, consentedAt: null }]);
    const lines = csv.replace("\uFEFF", "").split("\r\n");
    expect(lines[0]).toBe("recebido_em,nome,email,telefone,mensagem,consentimento,consentiu_em,texto_do_consentimento");
    expect(lines[1]).toBe('"2026-10-01T12:00:00Z","Ana","ana@exemplo.com.br","","","sim","2026-10-01T12:00:00Z","Aceito."');
    expect(csv).toContain('"\'+5511912345678","linha 1\nlinha 2","não",""');
  });
});
