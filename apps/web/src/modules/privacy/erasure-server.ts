import "server-only";
import { randomUUID } from "node:crypto";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { configuredSync } from "@/modules/billing/server";
import { endSubscriptionsNow } from "@/modules/billing/service";
import { getDomainsAdapter } from "@/modules/domains/server";
import { getSupabase } from "@/modules/identity/session";
import { runConfiguredMediaCleanup } from "@/modules/media/cleanup-server";
import { revalidatePublicPage } from "@/modules/publishing/cache";
import { eraseAccount, erasureRefusal, parseErasureBegin, parseErasureCounts, type ErasureResult } from "./erasure";

/**
 * Wiring of the account erasure for the signed-in platform administrator. The database steps run
 * with that person's session and refuse everyone else. The subscriptions to end come from the
 * database (never from the form), and are ended with the same provider credentials and the same
 * attested snapshot as every other billing change. The media cleanup is the existing
 * administrative job (secret key): it only runs after the first erasure step succeeded, which is
 * the database's own confirmation that the caller is a platform administrator.
 */
export async function eraseAccountForRequest(requestId: string, evidenceReference: string): Promise<ErasureResult> {
  const supabase = await getSupabase();
  const adapter = getDomainsAdapter();
  return eraseAccount({
    async endSubscriptions(id) {
      const { data, error } = await supabase.rpc("list_erasure_subscriptions", { p_request_id: id });
      if (error) {
        // Before the migration there is no list: the next step still refuses a running subscription.
        if (isMissingSchemaError(error)) return { ok: true, ended: 0 };
        return { ok: false, reason: erasureRefusal(error.code, false) };
      }
      const subscriptions = (data ?? []).map((row) => ({ subscriptionId: row.provider_subscription_id, customerId: row.provider_customer_id }));
      if (subscriptions.length === 0) return { ok: true, ended: 0 };
      const sync = configuredSync();
      if (!sync) return { ok: false, reason: "billing_not_configured" };
      const result = await endSubscriptionsNow(sync, subscriptions, randomUUID);
      for (const slug of result.slugs) revalidatePublicPage(slug);
      return result.ok ? { ok: true, ended: result.ended } : { ok: false, reason: "billing_failed" };
    },
    async begin(id) {
      const { data, error } = await supabase.rpc("begin_account_erasure", { p_request_id: id });
      if (error) return { ok: false, reason: erasureRefusal(error.code, isMissingSchemaError(error)) };
      return { ok: true, value: parseErasureBegin(data) };
    },
    async finish(id, evidence) {
      const { data, error } = await supabase.rpc("finish_account_erasure", { p_request_id: id, p_evidence_reference: evidence });
      if (error) return { ok: false, reason: erasureRefusal(error.code, isMissingSchemaError(error)) };
      return { ok: true, value: parseErasureCounts(data) };
    },
    revalidate: revalidatePublicPage,
    detach: adapter ? (hostname) => adapter.detach(hostname) : null,
    async cleanMedia() {
      try {
        const report = await runConfiguredMediaCleanup();
        return report ? { failed: report.failed } : null;
      } catch {
        return { failed: 1 };
      }
    },
  }, requestId, evidenceReference);
}
