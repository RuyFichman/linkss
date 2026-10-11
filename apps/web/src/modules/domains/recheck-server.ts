import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { revalidatePublicPage } from "@/modules/publishing/cache";
import { domainsSignerFromEnv } from "./config";
import { createNodeDns } from "./dns";
import { runDomainRecheck, type RecheckReport, type RecheckStatus } from "./recheck";
import { getDomainsAdapter } from "./server";

export type RecheckRun = { kind: "done"; report: RecheckReport } | { kind: "not_configured" } | { kind: "domains_off" } | { kind: "not_deployed" };

const STATUSES: readonly RecheckStatus[] = ["ok", "missing", "lapsed", "skipped", "not_found", "invalid", "not_configured"];

/**
 * Re-verification job wiring. An administrative job with no signed-in user (secret key); the two
 * functions it calls are granted to the service role only. Without the signing secret no domain
 * can be active in this environment, so there is nothing to verify (`domains_off`).
 */
export async function runConfiguredDomainRecheck(): Promise<RecheckRun> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return { kind: "not_configured" };
  const sign = domainsSignerFromEnv();
  if (!sign) return { kind: "domains_off" };
  const client = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const adapter = getDomainsAdapter();
  let missingSchema = false;
  const report = await runDomainRecheck({
    async list(limit) {
      const { data, error } = await client.rpc("list_domains_for_recheck", { p_limit: limit });
      if (error) {
        if (isMissingSchemaError(error)) {
          missingSchema = true;
          return [];
        }
        throw new Error(`Domain recheck list failed: ${error.code}`);
      }
      return data.map((row) => ({ id: row.domain_id, hostname: row.hostname, challenge: row.challenge }));
    },
    async record(text, signature) {
      const { data, error } = await client.rpc("record_domain_recheck", { p_text: text, p_signature: signature });
      if (error) throw new Error(`Domain recheck record failed: ${error.code}`);
      const row = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
      const status = STATUSES.find((item) => item === row.status) ?? "invalid";
      return { status, slug: typeof row.slug === "string" ? row.slug : null };
    },
    dns: createNodeDns(),
    sign,
    revalidate: revalidatePublicPage,
    detach: adapter ? (hostname) => adapter.detach(hostname) : null,
  });
  return missingSchema ? { kind: "not_deployed" } : { kind: "done", report };
}
