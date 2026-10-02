import { AuthorizationError, isUuid, requireUser, requireWorkspaceAccess, type IdentityPort } from "@/modules/identity/guard";
import type { FormField } from "@/modules/blocks/form";
import { validateSubmission, type FormDefinition, type LeadFieldProblems, type LeadValues, type RawSubmission } from "./submission";

// ---------------------------------------------------------------------------------------------
// Visitor side: anonymous submission
// ---------------------------------------------------------------------------------------------

/** Statuses of public.submit_form_lead(). Nothing else is ever revealed to a visitor. */
export type LeadSubmitStatus = "ok" | "invalid" | "consent_required" | "rate_limited" | "unavailable";

export function isLeadSubmitStatus(value: unknown): value is LeadSubmitStatus {
  return value === "ok" || value === "invalid" || value === "consent_required" || value === "rate_limited" || value === "unavailable";
}

export interface LeadSubmissionRepository {
  /** The form as published at this address, or null (not published, suspended, form removed). */
  findPublishedForm(slug: string, blockId: string): Promise<FormDefinition | null>;
  submit(input: { slug: string; blockId: string; values: LeadValues; consent: boolean; honeypot: string; clientHash: string | null }): Promise<LeadSubmitStatus>;
}

export interface LeadSubmitResult {
  status: LeadSubmitStatus;
  problems?: LeadFieldProblems;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Submits a visitor's form (ADR 0010). The application validates against the published form to
 * answer with field-level problems; the database validates again, enforces consent, the honeypot
 * and the rate limits, and stores the lead. A filled honeypot gets the same "ok" as a real
 * submission and never reaches the database.
 */
export function createLeadSubmissionService(repository: LeadSubmissionRepository, dependencies: { clientHash: () => string | null }) {
  return {
    async submit(slug: unknown, blockId: unknown, raw: RawSubmission): Promise<LeadSubmitResult> {
      if (typeof slug !== "string" || !SLUG_PATTERN.test(slug) || slug.length > 40 || !isUuid(blockId)) return { status: "unavailable" };
      if (typeof raw.honeypot === "string" && raw.honeypot.trim() !== "") return { status: "ok" };
      try {
        const definition = await repository.findPublishedForm(slug, blockId);
        if (!definition) return { status: "unavailable" };
        const check = validateSubmission(definition, raw);
        if (!check.ok) {
          if (check.reason === "honeypot") return { status: "ok" };
          return check.reason === "invalid" ? { status: "invalid", problems: check.problems } : { status: "consent_required" };
        }
        return { status: await repository.submit({ slug, blockId, values: check.values, consent: check.consent, honeypot: "", clientHash: dependencies.clientHash() }) };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Owner side: list, delete, export
// ---------------------------------------------------------------------------------------------

export interface Lead {
  id: string;
  blockId: string;
  values: Partial<Record<FormField, string>>;
  consentGiven: boolean;
  consentText: string;
  consentedAt: string | null;
  createdAt: string;
  purgeAfter: string;
}

export type LeadsErrorKind = "forbidden" | "not_found" | "unavailable";
export type LeadsResult<T> = { ok: true; value: T } | { ok: false; error: LeadsErrorKind | "unauthenticated" };

/** Persistence port. The Supabase implementation runs as the signed-in user, under RLS. */
export interface LeadsRepository {
  findProfile(profileId: string): Promise<{ id: string; workspaceId: string } | null>;
  list(profileId: string, limit: number): Promise<{ leads: Lead[]; total: number }>;
  remove(leadId: string): Promise<{ ok: true } | { ok: false; error: LeadsErrorKind }>;
  recordExport(profileId: string, count: number): Promise<{ ok: true } | { ok: false; error: LeadsErrorKind }>;
}

/** Leads shown on the page. The export uses its own, larger bound. */
export const LEADS_PAGE_LIMIT = 100;
export const LEADS_EXPORT_LIMIT = 5000;

const CSV_COLUMNS = ["recebido_em", "nome", "email", "telefone", "mensagem", "consentimento", "consentiu_em", "texto_do_consentimento"] as const;

/**
 * One CSV cell. Quotes are doubled, and a value that a spreadsheet would run as a formula
 * (starting with =, +, -, @, tab or carriage return) gets a leading apostrophe.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function leadsToCsv(leads: readonly Lead[]): string {
  const rows = leads.map((lead) => [
    lead.createdAt, lead.values.name ?? "", lead.values.email ?? "", lead.values.phone ?? "", lead.values.message ?? "",
    lead.consentGiven ? "sim" : "não", lead.consentedAt ?? "", lead.consentText,
  ].map(csvCell).join(","));
  // Byte-order mark so spreadsheet programs read accents as UTF-8.
  return `\uFEFF${[CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}

/**
 * Owner-side commands. Authorization happens here first (membership re-read per request), then
 * again in RLS and in the security definer RPCs.
 */
export function createLeadsService(identity: IdentityPort, repository: LeadsRepository) {
  async function authorize(profileId: unknown, action: "leads.view" | "leads.delete" | "leads.export") {
    await requireUser(identity);
    if (!isUuid(profileId)) throw new AuthorizationError("not_found");
    const profile = await repository.findProfile(profileId);
    if (!profile) throw new AuthorizationError("not_found");
    await requireWorkspaceAccess(identity, profile.workspaceId, action);
    return profile;
  }

  function failure<T>(error: unknown): LeadsResult<T> {
    if (!(error instanceof AuthorizationError)) throw error;
    return { ok: false, error: error.reason };
  }

  return {
    async list(profileId: unknown): Promise<LeadsResult<{ leads: Lead[]; total: number }>> {
      try {
        const profile = await authorize(profileId, "leads.view");
        return { ok: true, value: await repository.list(profile.id, LEADS_PAGE_LIMIT) };
      } catch (error) {
        return failure(error);
      }
    },

    async remove(profileId: unknown, leadId: unknown): Promise<LeadsResult<null>> {
      try {
        await authorize(profileId, "leads.delete");
      } catch (error) {
        return failure(error);
      }
      if (!isUuid(leadId)) return { ok: false, error: "not_found" };
      const removed = await repository.remove(leadId);
      return removed.ok ? { ok: true, value: null } : removed;
    },

    /** CSV of every available lead of the page. The export is audited before the file is returned. */
    async exportCsv(profileId: unknown): Promise<LeadsResult<{ csv: string; count: number }>> {
      let profile;
      try {
        profile = await authorize(profileId, "leads.export");
      } catch (error) {
        return failure(error);
      }
      const { leads } = await repository.list(profile.id, LEADS_EXPORT_LIMIT);
      const recorded = await repository.recordExport(profile.id, leads.length);
      if (!recorded.ok) return recorded;
      return { ok: true, value: { csv: leadsToCsv(leads), count: leads.length } };
    },
  };
}
