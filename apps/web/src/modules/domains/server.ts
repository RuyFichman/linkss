import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { getSupabase, supabaseIdentity } from "@/modules/identity/session";
import type { DomainsAdapter } from "./adapter";
import { domainsSignerFromEnv, ownHostnames, resolveDomainsProvider } from "./config";
import { createNodeDns } from "./dns";
import { createDomainsService, domainErrorFromDatabase, type ConfirmStatus, type DomainsRepository, type DomainSummary } from "./service";
import { createVercelAdapter } from "./vercel-adapter";

const COLUMNS = "id, profile_id, workspace_id, hostname, challenge, status, routing, verified_at, last_checked_at";

type DomainRow = { id: string; profile_id: string; workspace_id: string; hostname: string; challenge: string; status: string; routing: string; verified_at: string | null; last_checked_at: string | null };

function toSummary(row: DomainRow): DomainSummary {
  return {
    id: row.id, profileId: row.profile_id, workspaceId: row.workspace_id, hostname: row.hostname, challenge: row.challenge,
    status: row.status === "active" || row.status === "lapsed" ? row.status : "pending",
    routing: row.routing === "ok" || row.routing === "pending" ? row.routing : "unknown",
    verifiedAt: row.verified_at, lastCheckedAt: row.last_checked_at,
  };
}

const CONFIRM_STATUSES: readonly ConfirmStatus[] = ["active", "dns_missing", "in_use", "not_in_plan"];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Runs as the signed-in user: reads are filtered by RLS and every write is a checked RPC. */
export function createSupabaseDomainsRepository(supabase: SupabaseServerClient): DomainsRepository {
  return {
    async findProfileWorkspace(profileId) {
      const { data, error } = await supabase.from("profiles").select("workspace_id").eq("id", profileId).maybeSingle();
      if (error) throw new Error(`Domain page lookup failed: ${error.code}`);
      return data?.workspace_id ?? null;
    },

    async findDomain(domainId) {
      const { data, error } = await supabase.from("profile_domains").select(COLUMNS).eq("id", domainId).maybeSingle();
      // Before the migration, or for a row RLS hides, the answer is the same: there is no such domain.
      return error || !data ? null : toSummary(data);
    },

    async findForProfile(profileId) {
      const { data, error } = await supabase.from("profile_domains").select(COLUMNS).eq("profile_id", profileId).maybeSingle();
      if (error) return { ok: false, error: domainErrorFromDatabase(error) };
      return { ok: true, value: data ? toSummary(data) : null };
    },

    async claim(profileId, hostname) {
      const { data, error } = await supabase.rpc("claim_profile_domain", { p_profile_id: profileId, p_hostname: hostname }).single();
      return error ? { ok: false, error: domainErrorFromDatabase(error) } : { ok: true, value: { id: data.domain_id, hostname: data.hostname, challenge: data.challenge } };
    },

    async confirm(text, signature) {
      const { data, error } = await supabase.rpc("confirm_profile_domain", { p_text: text, p_signature: signature });
      if (error) return { ok: false, error: domainErrorFromDatabase(error) };
      const answer = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
      const status = answer.status;
      if (status === "not_configured" || status === "not_found" || status === "forbidden") return { ok: false, error: status };
      const known = CONFIRM_STATUSES.find((candidate) => candidate === status);
      // "invalid" here is a rejected attestation (clock skew, secret mismatch): an environment problem, not the person's.
      if (!known) return { ok: false, error: status === "invalid" ? "not_configured" : "unavailable" };
      const slugs = Array.isArray(answer.slugs) ? answer.slugs.filter((slug): slug is string => typeof slug === "string" && SLUG.test(slug)) : [];
      return { ok: true, value: { status: known, slugs } };
    },

    async remove(domainId) {
      const { data, error } = await supabase.rpc("remove_profile_domain", { p_domain_id: domainId }).single();
      return error ? { ok: false, error: domainErrorFromDatabase(error) } : { ok: true, value: { hostname: data.hostname, slug: data.slug, wasActive: data.was_active } };
    },
  };
}

/** The hosting provider of this environment, or null when none is configured. */
export function getDomainsAdapter(): DomainsAdapter | null {
  const provider = resolveDomainsProvider();
  return provider.kind === "vercel" ? createVercelAdapter(provider.config) : null;
}

/** Request-scoped domains service acting as the signed-in user. */
export async function getDomainsService() {
  const supabase = await getSupabase();
  return createDomainsService({
    identity: supabaseIdentity(supabase),
    repository: createSupabaseDomainsRepository(supabase),
    dns: createNodeDns(),
    adapter: getDomainsAdapter(),
    sign: domainsSignerFromEnv(),
    ownHosts: ownHostnames(),
  });
}
