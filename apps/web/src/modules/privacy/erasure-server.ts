import "server-only";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { getDomainsAdapter } from "@/modules/domains/server";
import { getSupabase } from "@/modules/identity/session";
import { runConfiguredMediaCleanup } from "@/modules/media/cleanup-server";
import { revalidatePublicPage } from "@/modules/publishing/cache";
import { eraseAccount, erasureRefusal, parseErasureBegin, parseErasureCounts, type ErasureResult } from "./erasure";

/**
 * Wiring of the account erasure for the signed-in platform administrator. The two database steps
 * run with that person's session and refuse everyone else. The media cleanup in between is the
 * existing administrative job (secret key): it only runs after the first step succeeded, which is
 * the database's own confirmation that the caller is a platform administrator.
 */
export async function eraseAccountForRequest(requestId: string, evidenceReference: string): Promise<ErasureResult> {
  const supabase = await getSupabase();
  const adapter = getDomainsAdapter();
  return eraseAccount({
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
