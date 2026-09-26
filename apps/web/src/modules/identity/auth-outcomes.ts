/**
 * Maps Supabase Auth errors to user-facing outcomes. Sign-up and recovery collapse every result
 * that could depend on whether an email exists into the same neutral outcome (ADR 0005).
 */
export interface AuthErrorLike {
  code?: string | null;
  status?: number | null;
}

// Any of these may be returned only for existing addresses; they must look like success.
const EXISTENCE_DEPENDENT_CODES = new Set(["user_already_exists", "email_exists", "over_email_send_rate_limit", "email_address_not_authorized"]);

function isInfrastructureFailure(error: AuthErrorLike): boolean {
  return error.status === undefined || error.status === null || error.status === 0 || error.status >= 500;
}

export type SignUpOutcome = "check-email" | "weak-password" | "invalid-email" | "rate-limited" | "unavailable";
export function signUpOutcome(error: AuthErrorLike | null | undefined): SignUpOutcome {
  if (!error) return "check-email";
  if (error.code && EXISTENCE_DEPENDENT_CODES.has(error.code)) return "check-email";
  if (error.code === "weak_password") return "weak-password";
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return "invalid-email";
  if (error.code === "over_request_rate_limit") return "rate-limited";
  return "unavailable";
}

export type RecoveryOutcome = "check-email" | "rate-limited" | "unavailable";
export function recoveryOutcome(error: AuthErrorLike | null | undefined): RecoveryOutcome {
  if (!error) return "check-email";
  if (error.code === "over_request_rate_limit") return "rate-limited";
  if (isInfrastructureFailure(error)) return "unavailable";
  return "check-email";
}

export type SignInOutcome = "signed-in" | "invalid-credentials" | "email-not-confirmed" | "rate-limited" | "unavailable";
export function signInOutcome(error: AuthErrorLike | null | undefined): SignInOutcome {
  if (!error) return "signed-in";
  // Only reachable with the correct password, so it does not reveal existence to a guesser.
  if (error.code === "email_not_confirmed") return "email-not-confirmed";
  if (error.code === "over_request_rate_limit") return "rate-limited";
  if (isInfrastructureFailure(error)) return "unavailable";
  return "invalid-credentials";
}

export type PasswordUpdateOutcome = "updated" | "weak-password" | "same-password" | "session-expired" | "unavailable";
export function passwordUpdateOutcome(error: AuthErrorLike | null | undefined): PasswordUpdateOutcome {
  if (!error) return "updated";
  if (error.code === "weak_password") return "weak-password";
  if (error.code === "same_password") return "same-password";
  if (error.code && ["session_not_found", "session_expired", "reauthentication_needed", "refresh_token_not_found"].includes(error.code)) return "session-expired";
  if (error.status === 401 || error.status === 403) return "session-expired";
  return "unavailable";
}

export type LinkType = "email" | "recovery" | "email_change" | "signup";
const LINK_TYPES: readonly LinkType[] = ["email", "recovery", "email_change", "signup"];

/** Only the email-link types we actually send are accepted by /auth/confirm. */
export function parseLinkType(value: string | null): LinkType | null {
  return LINK_TYPES.find((type) => type === value) ?? null;
}
