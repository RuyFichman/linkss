import type { Database } from "@/lib/database.types";

export type WorkspaceRole = Database["public"]["Enums"]["workspace_role"];
export type WorkspaceKind = Database["public"]["Enums"]["workspace_kind"];

export const WORKSPACE_ROLES = ["owner", "admin", "editor"] as const satisfies readonly WorkspaceRole[];

/**
 * Application mirror of the database role matrix (docs/adr/0004). RLS and the RPCs enforce the
 * same rules; pgTAP and Vitest cover both sides. Change them together.
 */
export const PERMISSIONS = {
  "workspace.view": ["owner", "admin", "editor"],
  "workspace.rename": ["owner", "admin"],
  "workspace.delete": ["owner"],
  "members.view": ["owner", "admin", "editor"],
  "members.change_role": ["owner", "admin"],
  "members.remove": ["owner", "admin"],
  "profile.view": ["owner", "admin", "editor"],
  "profile.create": ["owner", "admin"],
  "profile.edit_content": ["owner", "admin", "editor"],
  "profile.change_slug": ["owner", "admin"],
  "profile.delete": ["owner", "admin"],
  "profile.publish": ["owner", "admin", "editor"],
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
