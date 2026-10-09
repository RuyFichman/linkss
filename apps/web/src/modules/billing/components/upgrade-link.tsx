import Link from "next/link";
import { BILLING_COPY } from "@/content/pt-BR";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import { resolveBillingMode } from "../mode";
import { upgradeHref } from "../presentation";

type UpgradeReason = keyof typeof BILLING_COPY.upgrade.linkFor;

/**
 * The way from a limit to the plans screen (ADR 0014). Renders nothing when billing is off or when
 * the person cannot buy (only the owner can), so those screens keep exactly the sentence they had
 * before billing existed. Navigation only: the plans screen and every command re-authorize.
 */
export function UpgradeLink({ workspaceId, role, reason }: { workspaceId: string; role: WorkspaceRole | null | undefined; reason: UpgradeReason }) {
  const href = upgradeHref(resolveBillingMode().mode, role, workspaceId);
  if (!href) return null;
  return <p className="m-0"><Link className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href={href}>{BILLING_COPY.upgrade.linkFor[reason]}</Link></p>;
}
