import { can, type WorkspaceAction, type WorkspaceRole } from "./permissions";

export type AuthorizationFailure = "unauthenticated" | "not_found" | "forbidden";

export class AuthorizationError extends Error {
  constructor(readonly reason: AuthorizationFailure) {
    super(`Authorization failed: ${reason}`);
    this.name = "AuthorizationError";
  }
}

/** Server-side identity lookups. The Supabase implementation lives in ./supabase-identity. */
export interface IdentityPort {
  currentUserId(): Promise<string | null>;
  roleIn(userId: string, workspaceId: string): Promise<WorkspaceRole | null>;
}

export interface WorkspaceAccess {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export async function requireUser(identity: IdentityPort): Promise<string> {
  const userId = await identity.currentUserId();
  if (!userId) throw new AuthorizationError("unauthenticated");
  return userId;
}

/**
 * The single gate used by every Server Action, route handler and page that touches workspace data.
 * Membership is re-read on every request; a workspace the caller does not belong to is reported as
 * "not_found" so identifiers of other tenants are never confirmed. RLS enforces the same rule again.
 */
export async function requireWorkspaceAccess(identity: IdentityPort, workspaceId: unknown, action: WorkspaceAction): Promise<WorkspaceAccess> {
  const userId = await requireUser(identity);
  if (!isUuid(workspaceId)) throw new AuthorizationError("not_found");
  const role = await identity.roleIn(userId, workspaceId);
  if (!role) throw new AuthorizationError("not_found");
  if (!can(role, action)) throw new AuthorizationError("forbidden");
  return { userId, workspaceId, role };
}
