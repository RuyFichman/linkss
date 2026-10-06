import { isInvitationPath } from "./invitations";

/** Set by sign-up when the person came from an invitation link; read only by /auth/confirm. */
export const AFTER_CONFIRM_COOKIE = "lnk_after_confirm";
export const AFTER_CONFIRM_MAX_AGE_SECONDS = 60 * 60;

/**
 * Where to go after a successful e-mail confirmation. The cookie is honored only when it holds an
 * exact invitation path, so it can never become an open redirect; anything else is ignored.
 */
export function afterConfirmPath(cookieValue: string | undefined, fallback: string): string {
  return isInvitationPath(cookieValue) ? cookieValue : fallback;
}
