import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { INVITABLE_ROLES, type InvitableRole } from "./permissions";

/** Mirrors private.invitation_ttl() (ADR 0012). The database is the authority; this is for display. */
export const INVITATION_TTL_DAYS = 7;
export const INVITATION_EMAIL_MAX_LENGTH = 254;

/** Mirror of private.normalize_email: trim, then lowercase. */
export function normalizeInvitationEmail(value: string): string {
  return value.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "").toLowerCase();
}

/** Same rule as the workspace_invitations check; expects a normalized address. */
export function isValidInvitationEmail(email: string): boolean {
  return email.length >= 3 && email.length <= INVITATION_EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function parseInvitableRole(value: unknown): InvitableRole | null {
  return (INVITABLE_ROLES as readonly unknown[]).includes(value) ? value as InvitableRole : null;
}

/** 32 random bytes in base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export function isInvitationToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export const INVITATION_PATH_PREFIX = "/app/convite/";
export function invitationPath(token: string): string {
  return `${INVITATION_PATH_PREFIX}${token}`;
}

/** True only for the exact acceptance path of a well-formed token (no query string, no suffix). */
export function isInvitationPath(path: unknown): path is string {
  return typeof path === "string" && path.startsWith(INVITATION_PATH_PREFIX) && isInvitationToken(path.slice(INVITATION_PATH_PREFIX.length));
}

export function invitationExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export type InvitationStatus = "pending" | "expired" | "revoked" | "accepted";

/** Display status of a stored invitation at `now`. An outcome wins over the clock. */
export function invitationStatus(invitation: { expiresAt: string; revokedAt: string | null; acceptedAt: string | null }, now: Date): InvitationStatus {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  const expires = Date.parse(invitation.expiresAt);
  return Number.isFinite(expires) && expires > now.getTime() ? "pending" : "expired";
}

/** What the acceptance screen can show. Everything the database does not name is "invalid". */
export type InvitationViewState = "valid" | "wrong_account" | "already_member" | "limit_reached" | "invalid";

export function invitationViewState(databaseState: unknown): InvitationViewState {
  switch (databaseState) {
    case "valid":
    case "wrong_account":
    case "already_member":
    case "limit_reached":
      return databaseState;
    default:
      return "invalid";
  }
}

export type AcceptOutcome = "accepted" | Exclude<InvitationViewState, "valid">;

/** accept_workspace_invitation never answers "valid": anything unexpected is a refusal. */
export function acceptOutcome(databaseState: unknown): AcceptOutcome {
  if (databaseState === "accepted") return "accepted";
  const state = invitationViewState(databaseState);
  return state === "valid" ? "invalid" : state;
}

export type MemberErrorKind =
  | "invalid_email"
  | "already_member"
  | "rate_limited"
  | "limit_reached"
  | "last_owner"
  | "forbidden"
  | "not_found"
  | "not_deployed"
  | "unavailable";

/** Maps the SQLSTATE contract of ADR 0004/0012 to one outcome per failure. */
export function memberErrorFromDatabase(error: { code?: string | null }): MemberErrorKind {
  if (isMissingSchemaError(error)) return "not_deployed";
  switch (error.code) {
    case "22023": return "invalid_email";
    case "LK081": return "already_member";
    case "LK082": return "rate_limited";
    case "LK010": return "limit_reached";
    case "LK020": return "last_owner";
    case "42501": return "forbidden";
    case "P0002":
    case "PGRST116": return "not_found";
    default: return "unavailable";
  }
}

export interface SeatUsage {
  members: number;
  pending: number;
  used: number;
  limit: number;
  remaining: number;
  reached: boolean;
}

/** Open invitations hold seats, exactly like private.workspace_seats_in_use. */
export function seatUsage(members: number, pendingInvitations: number, limit: number): SeatUsage {
  const used = members + pendingInvitations;
  const remaining = Math.max(0, limit - used);
  return { members, pending: pendingInvitations, used, limit, remaining, reached: remaining === 0 };
}
