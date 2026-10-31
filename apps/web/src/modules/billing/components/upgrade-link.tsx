import Link from "next/link";
import type { Copy } from "@/content/copy";
import { getCopy } from "@/modules/identity/locale";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import { resolveBillingMode } from "../mode";
import { upgradeHref } from "../presentation";

type UpgradeReason = keyof Copy["BILLING_COPY"]["upgrade"]["linkFor"];

/**
 * The way from a limit to the plans screen (ADR 0014). Renders nothing when billing is off or when
 * the person cannot buy (only the owner can), so those screens keep exactly the sentence they had
 * before billing existed. Navigation only: the plans screen and every command re-authorize.
 */
export async function UpgradeLink({ workspaceId, role, reason }: { workspaceId: string; role: WorkspaceRole | null | undefined; reason: UpgradeReason }) {
  const { BILLING_COPY } = await getCopy();
  const href = upgradeHref(resolveBillingMode().mode, role, workspaceId);
  if (!href) return null;
  return <p className="m-0"><Link className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href={href}>{BILLING_COPY.upgrade.linkFor[reason]}</Link></p>;
}
