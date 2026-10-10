import type { Entitlements } from "@/modules/entitlements";

/**
 * What a move to another plan does to a workspace as it is today (ADR 0014, AC3). Pure: it only
 * compares usage with the two sets of entitlements and never names a plan.
 *
 * Rule for every line: nothing is deleted. `blocked` means what exists stays and works, and only
 * creating more is refused; `stops` means something stops working (and comes back if the
 * entitlement comes back); `kept` means the usage fits the target plan.
 */
export interface WorkspaceUsage {
  /** Pages that are not deleted (archived ones count, UX-019). */
  pages: number;
  members: number;
  pendingInvitations: number;
  /** Report links that open today. */
  activeReportLinks: number;
  storageBytes: number;
  /** Custom domains whose control is proven (ADR 0016). */
  activeDomains: number;
  /** Pages with a Meta Pixel or Google Analytics identifier (ADR 0017). */
  pagesWithPixels: number;
}

export type ImpactKind = "kept" | "blocked" | "stops";

export type ImpactItem =
  | { key: "max_profiles"; kind: ImpactKind; used: number; limit: number; over: number }
  | { key: "team_members"; kind: ImpactKind; used: number; members: number; pendingInvitations: number; limit: number; over: number }
  | { key: "storage_mb"; kind: ImpactKind; usedMb: number; limitMb: number }
  | { key: "analytics_days"; kind: ImpactKind; from: number; to: number }
  | { key: "shareable_reports"; kind: ImpactKind; activeLinks: number }
  | { key: "remove_badge"; kind: ImpactKind }
  | { key: "custom_domain"; kind: ImpactKind; domains: number }
  | { key: "tracking_pixels"; kind: ImpactKind; pages: number };

const MEBIBYTE = 1024 * 1024;

export function downgradeImpact(usage: WorkspaceUsage, current: Entitlements, target: Entitlements): ImpactItem[] {
  const items: ImpactItem[] = [];

  const pagesOver = Math.max(0, usage.pages - target.limits.max_profiles);
  items.push({ key: "max_profiles", kind: pagesOver > 0 ? "blocked" : "kept", used: usage.pages, limit: target.limits.max_profiles, over: pagesOver });

  const seats = usage.members + usage.pendingInvitations;
  const seatsOver = Math.max(0, seats - target.limits.team_members);
  items.push({ key: "team_members", kind: seatsOver > 0 ? "blocked" : "kept", used: seats, members: usage.members, pendingInvitations: usage.pendingInvitations, limit: target.limits.team_members, over: seatsOver });

  const usedMb = Math.ceil(usage.storageBytes / MEBIBYTE);
  items.push({ key: "storage_mb", kind: usage.storageBytes > target.limits.storage_mb * MEBIBYTE ? "blocked" : "kept", usedMb, limitMb: target.limits.storage_mb });

  if (target.limits.analytics_days < current.limits.analytics_days) {
    items.push({ key: "analytics_days", kind: "stops", from: current.limits.analytics_days, to: target.limits.analytics_days });
  } else {
    items.push({ key: "analytics_days", kind: "kept", from: current.limits.analytics_days, to: target.limits.analytics_days });
  }

  if (current.features.shareable_reports) {
    items.push({ key: "shareable_reports", kind: target.features.shareable_reports ? "kept" : "stops", activeLinks: usage.activeReportLinks });
  }
  if (current.features.remove_badge) {
    items.push({ key: "remove_badge", kind: target.features.remove_badge ? "kept" : "stops" });
  }
  // Listed only when the workspace uses them: a line about a domain nobody configured is noise.
  if (current.features.custom_domain && usage.activeDomains > 0) {
    items.push({ key: "custom_domain", kind: target.features.custom_domain ? "kept" : "stops", domains: usage.activeDomains });
  }
  if (current.features.tracking_pixels && usage.pagesWithPixels > 0) {
    items.push({ key: "tracking_pixels", kind: target.features.tracking_pixels ? "kept" : "stops", pages: usage.pagesWithPixels });
  }
  return items;
}

/** True when the move takes something away or leaves the workspace above a limit. */
export function hasImpact(items: readonly ImpactItem[]): boolean {
  return items.some((item) => item.kind !== "kept");
}
