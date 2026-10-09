import Link from "next/link";
import { BILLING_COPY } from "@/content/pt-BR";
import { can, type WorkspaceRole } from "@/modules/identity/permissions";
import { billingBannerSentence } from "../presentation";
import { fetchWorkspaceBilling } from "../server";
import { billingViewState } from "../subscription";

/**
 * Shown across a workspace while a payment is failing (ADR 0014): what happened, until when the
 * plan holds, and the way to fix it. Owners get the link; admins are told who can act; editors see
 * nothing about payment (RLS returns them no subscription, and the role is checked here too).
 * A read that fails or a database without the migration shows no banner: it never blocks a page.
 */
export async function BillingBanner({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  if (!can(role, "billing.view")) return null;
  let sentence: string | null = null;
  try {
    const billing = await fetchWorkspaceBilling(workspaceId, false);
    sentence = billingBannerSentence(billingViewState(billing.record, billing.planId, new Date()));
  } catch {
    return null;
  }
  if (!sentence) return null;
  const copy = BILLING_COPY.banner;
  return (
    <div data-app-chrome="" role="status" className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-app-danger/30 bg-app-danger/10 p-3 text-app-danger">
      <p className="m-0 min-w-0 flex-1 basis-64 font-bold"><span>{copy.label}: </span>{sentence}</p>
      {can(role, "billing.manage")
        ? <Link className="ui-button ui-button-secondary" href={`/app/w/${workspaceId}/plano`}>{copy.ownerAction}</Link>
        : <span className="text-sm">{copy.adminHint}</span>}
    </div>
  );
}
