import "server-only";
import type { Json } from "@/lib/database.types";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { findPublishedForm, parsePublishedDocument } from "@/modules/publishing/document";
import { isLeadSubmitStatus, type Lead, type LeadsErrorKind, type LeadsRepository, type LeadSubmissionRepository } from "./service";

/**
 * Visitor side. Acts as `anon` (publishable key, no cookies): the only things it can reach are
 * public.get_public_page() and public.submit_form_lead().
 */
export function createSupabaseLeadSubmissionRepository(): LeadSubmissionRepository {
  const supabase = createPublicSupabaseClient();
  return {
    async findPublishedForm(slug, blockId) {
      const { data, error } = await supabase.rpc("get_public_page", { p_slug: slug }).maybeSingle();
      if (error) throw new Error(`Published form lookup failed: ${error.code}`);
      if (!data || data.state !== "published") return null;
      const document = parsePublishedDocument(data.document);
      const form = document ? findPublishedForm(document, blockId) : null;
      return form ? { fields: form.fields, consentRequired: form.consentRequired } : null;
    },

    async submit(input) {
      const args = { p_slug: input.slug, p_block_id: input.blockId, p_fields: input.values as unknown as Json, p_consent: input.consent, p_honeypot: input.honeypot };
      const { data, error } = await supabase.rpc("submit_form_lead", input.clientHash ? { ...args, p_client_hash: input.clientHash } : args);
      if (error) throw new Error(`Lead submission failed: ${error.code}`);
      return isLeadSubmitStatus(data) ? data : "unavailable";
    },
  };
}

function leadsError(error: { code?: string | null }): LeadsErrorKind {
  switch (error.code) {
    case "42501": return "forbidden";
    case "P0002":
    case "PGRST116": return "not_found";
    default: return "unavailable";
  }
}

const LEAD_COLUMNS = "id, block_id, name, email, phone, message, consent_given, consent_text, consented_at, created_at, purge_after";

/** Owner side. Runs as the signed-in user: RLS limits the rows to the caller's workspaces. */
export function createSupabaseLeadsRepository(supabase: SupabaseServerClient): LeadsRepository {
  return {
    async findProfile(profileId) {
      const { data, error } = await supabase.from("profiles").select("id, workspace_id").eq("id", profileId).maybeSingle();
      if (error) throw new Error(`Leads profile lookup failed: ${error.code}`);
      return data ? { id: data.id, workspaceId: data.workspace_id } : null;
    },

    async list(profileId, limit) {
      const { data, error, count } = await supabase
        .from("form_leads")
        .select(LEAD_COLUMNS, { count: "exact" })
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`Leads listing failed: ${error.code}`);
      const leads: Lead[] = data.map((row) => ({
        id: row.id,
        blockId: row.block_id,
        values: { ...(row.name ? { name: row.name } : {}), ...(row.email ? { email: row.email } : {}), ...(row.phone ? { phone: row.phone } : {}), ...(row.message ? { message: row.message } : {}) },
        consentGiven: row.consent_given,
        consentText: row.consent_text,
        consentedAt: row.consented_at,
        createdAt: row.created_at,
        purgeAfter: row.purge_after,
      }));
      return { leads, total: count ?? leads.length };
    },

    async remove(leadId) {
      const { error } = await supabase.rpc("delete_form_lead", { p_lead_id: leadId });
      return error ? { ok: false, error: leadsError(error) } : { ok: true };
    },

    async recordExport(profileId, count) {
      const { error } = await supabase.rpc("record_lead_export", { p_profile_id: profileId, p_count: count });
      return error ? { ok: false, error: leadsError(error) } : { ok: true };
    },
  };
}
