import type { Database } from "@/lib/database.types";

export type WorkspaceRole = Database["public"]["Enums"]["workspace_role"];
export type WorkspaceKind = Database["public"]["Enums"]["workspace_kind"];

export const WORKSPACE_ROLES = ["owner", "admin", "editor"] as const satisfies readonly WorkspaceRole[];

/**
 * Application mirror of the database role matrix (docs/adr/0004, 0012, 0013 and 0014). RLS and the RPCs enforce the
 * same rules; pgTAP and Vitest cover both sides. Change them together.
 */
export const PERMISSIONS = {
  "workspace.view": ["owner", "admin", "editor"],
  "workspace.rename": ["owner", "admin"],
  "workspace.delete": ["owner"],
  "members.view": ["owner", "admin", "editor"],
  "members.change_role": ["owner", "admin"],
  "members.remove": ["owner", "admin"],
  // Bringing someone in changes who can reach the workspace: owners and admins only (ADR 0012).
  "members.invite": ["owner", "admin"],
  "invitations.view": ["owner", "admin"],
  "invitations.revoke": ["owner", "admin"],
  "profile.view": ["owner", "admin", "editor"],
  "profile.create": ["owner", "admin"],
  "profile.edit_content": ["owner", "admin", "editor"],
  "profile.change_slug": ["owner", "admin"],
  "profile.delete": ["owner", "admin"],
  "profile.publish": ["owner", "admin", "editor"],
  // Archiving takes a page off the air and duplicating consumes a paid entitlement (ADR 0012).
  "profile.archive": ["owner", "admin"],
  "profile.duplicate": ["owner", "admin"],
  // Leads are visitors' personal data: everyone who operates the page reads them, but removing
  // and taking them out of the product is limited to owners and admins (ADR 0010).
  "leads.view": ["owner", "admin", "editor"],
  "leads.delete": ["owner", "admin"],
  "leads.export": ["owner", "admin"],
  // Analytics are aggregates about the page, with no visitor data: every member who operates the
  // page reads and exports them (ADR 0011).
  "analytics.view": ["owner", "admin", "editor"],
  "analytics.export": ["owner", "admin", "editor"],
  // A report link publishes a page's results outside the workspace, to whoever holds it: creating,
  // listing and revoking are limited to owners and admins (ADR 0013).
  "reports.view": ["owner", "admin"],
  "reports.create": ["owner", "admin"],
  "reports.revoke": ["owner", "admin"],
  // Money: owners and admins see the plan and its limits; only the owner pays, changes the plan and
  // cancels. Editors see nothing about payment (ADR 0014).
  "billing.view": ["owner", "admin"],
  "billing.manage": ["owner"],
  // A custom domain changes where a page answers and pixels send visitors' data to third parties:
  // every member sees them, owners and admins change them (ADR 0016, ADR 0017).
  "domains.view": ["owner", "admin", "editor"],
  "domains.manage": ["owner", "admin"],
  "pixels.view": ["owner", "admin", "editor"],
  "pixels.manage": ["owner", "admin"],
  "audit.view": ["owner", "admin"],
} as const satisfies Record<string, readonly WorkspaceRole[]>;

export type WorkspaceAction = keyof typeof PERMISSIONS;

export function can(role: WorkspaceRole | null | undefined, action: WorkspaceAction): boolean {
  if (!role) return false;
  return (PERMISSIONS[action] as readonly WorkspaceRole[]).includes(role);
}

/** Admins manage non-owners only and can never grant ownership. */
export function canChangeRole(actor: WorkspaceRole, target: WorkspaceRole, next: WorkspaceRole): boolean {
  if (!can(actor, "members.change_role")) return false;
  if (actor === "owner") return true;
  return target !== "owner" && next !== "owner";
}

/** Anyone may leave; removing others follows the same owner rule as role changes. */
export function canRemoveMember(actor: WorkspaceRole, target: WorkspaceRole, isSelf: boolean): boolean {
  if (isSelf) return true;
  if (!can(actor, "members.remove")) return false;
  return actor === "owner" || target !== "owner";
}

/** Roles an invitation may grant. Ownership is never granted by invitation (ADR 0012). */
export const INVITABLE_ROLES = ["admin", "editor"] as const satisfies readonly WorkspaceRole[];
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function canInvite(actor: WorkspaceRole, role: unknown): role is InvitableRole {
  return can(actor, "members.invite") && (INVITABLE_ROLES as readonly unknown[]).includes(role);
}

/** Roles the actor may give to a member who currently has `target`. */
export function assignableRoles(actor: WorkspaceRole, target: WorkspaceRole): WorkspaceRole[] {
  return WORKSPACE_ROLES.filter((next) => next !== target && canChangeRole(actor, target, next));
}
