"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COPY } from "@/content/pt-BR";
import { appUrl } from "@/lib/app-url";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { recordAuthEvent } from "@/modules/audit/record";
import { passwordUpdateOutcome, recoveryOutcome, signInOutcome, signUpOutcome } from "./auth-outcomes";
import { validateEmailOnly, validateNewPassword, validateSignIn, validateSignUp } from "./auth-validation";
import { safeNextPath } from "./redirects";
import { ensurePersonalWorkspace, getCurrentUserId, getSupabase } from "./session";
import { NEUTRAL_RESPONSE_MIN_MS, withMinimumDuration } from "./timing";

async function correlationId(): Promise<string> {
  return correlationIdFrom((await headers()).get(CORRELATION_HEADER));
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

const CONFIRM_URL = appUrl("/auth/confirm?next=/app");
const RECOVERY_URL = appUrl("/auth/confirm?next=/redefinir-senha");

export async function signUpAction(_previous: FormState, formData: FormData): Promise<FormState<"name" | "email" | "password">> {
  const validation = validateSignUp(formData);
  const values = { name: stringField(formData, "name"), email: stringField(formData, "email") };
  if (!validation.ok) return { status: "error", message: AUTH_COPY.validation.summary, fieldErrors: validation.errors, values };

  const { name, email, password } = validation.value;
  const supabase = await getSupabase();
  const { error } = await withMinimumDuration(
    () => supabase.auth.signUp({ email, password, options: { emailRedirectTo: CONFIRM_URL, data: { display_name: name } } }),
    NEUTRAL_RESPONSE_MIN_MS,
  );
  const outcome = signUpOutcome(error);
  logEvent(outcome === "unavailable" ? "error" : "info", "auth.sign_up", { correlationId: await correlationId(), outcome, errorCode: error?.code ?? null });

  switch (outcome) {
    case "check-email": return { status: "success", message: AUTH_COPY.signUp.checkEmail };
    case "weak-password": return { status: "error", message: AUTH_COPY.validation.summary, fieldErrors: { password: AUTH_COPY.validation.passwordLettersDigits }, values };
    case "invalid-email": return { status: "error", message: AUTH_COPY.validation.summary, fieldErrors: { email: AUTH_COPY.validation.email }, values };
    case "rate-limited": return { status: "error", message: AUTH_COPY.rateLimited, values };
    case "unavailable": return { status: "error", message: AUTH_COPY.unavailable, values };
  }
}

export async function signInAction(_previous: FormState, formData: FormData): Promise<FormState<"email" | "password">> {
  const validation = validateSignIn(formData);
  const values = { email: stringField(formData, "email") };
  if (!validation.ok) return { status: "error", message: AUTH_COPY.validation.summary, fieldErrors: validation.errors, values };

  const supabase = await getSupabase();
  const { error } = await withMinimumDuration(() => supabase.auth.signInWithPassword(validation.value), NEUTRAL_RESPONSE_MIN_MS);
  const outcome = signInOutcome(error);
  const requestId = await correlationId();
  logEvent(outcome === "unavailable" ? "error" : "info", "auth.sign_in", { correlationId: requestId, outcome, errorCode: error?.code ?? null });

  switch (outcome) {
    case "invalid-credentials": return { status: "error", message: AUTH_COPY.signIn.invalidCredentials, values };
    case "email-not-confirmed": return { status: "error", message: AUTH_COPY.signIn.emailNotConfirmed, values, code: "email-not-confirmed" };
    case "rate-limited": return { status: "error", message: AUTH_COPY.rateLimited, values };
    case "unavailable": return { status: "error", message: AUTH_COPY.unavailable, values };
    case "signed-in": break;
  }

  await recordAuthEvent(supabase, "auth.sign_in", { method: "password", correlation_id: requestId });
  // Self-healing: the authenticated layout retries if this fails.
  await ensurePersonalWorkspace(supabase);
  redirect(safeNextPath(stringField(formData, "next")));
}

export async function resendConfirmationAction(_previous: FormState, formData: FormData): Promise<FormState<"email">> {
  const validation = validateEmailOnly(formData);
  const values = { email: stringField(formData, "email") };
  if (!validation.ok) return { status: "error", message: AUTH_COPY.validation.summary, fieldErrors: validation.errors, values };

  const supabase = await getSupabase();
  const { error } = await withMinimumDuration(
    () => supabase.auth.resend({ type: "signup", email: validation.value.email, options: { emailRedirectTo: CONFIRM_URL } }),
    NEUTRAL_RESPONSE_MIN_MS,
  );
  const outcome = recoveryOutcome(error);
  logEvent(outcome === "unavailable" ? "error" : "info", "auth.confirmation_resent", { correlationId: await correlationId(), outcome, errorCode: error?.code ?? null });
  if (outcome === "rate-limited") return { status: "error", message: AUTH_COPY.rateLimited, values };
  if (outcome === "unavailable") return { status: "error", message: AUTH_COPY.unavailable, values };
  return { status: "success", message: AUTH_COPY.confirmEmail.sent };
}

export async function requestRecoveryAction(_previous: FormState, formData: FormData): Promise<FormState<"email">> {
  const validation = validateEmailOnly(formData);
  const values = { email: stringField(formData, "email") };
  if (!validation.ok) return { status: "error", message: AUTH_COPY.validation.summary, fieldErrors: validation.errors, values };

  const supabase = await getSupabase();
  const { error } = await withMinimumDuration(() => supabase.auth.resetPasswordForEmail(validation.value.email, { redirectTo: RECOVERY_URL }), NEUTRAL_RESPONSE_MIN_MS);
  const outcome = recoveryOutcome(error);
  logEvent(outcome === "unavailable" ? "error" : "info", "auth.recovery_requested", { correlationId: await correlationId(), outcome, errorCode: error?.code ?? null });
  if (outcome === "rate-limited") return { status: "error", message: AUTH_COPY.rateLimited, values };
  if (outcome === "unavailable") return { status: "error", message: AUTH_COPY.unavailable, values };
  return { status: "success", message: AUTH_COPY.recovery.sent };
}

export async function updatePasswordAction(_previous: FormState, formData: FormData): Promise<FormState<"password" | "confirmation">> {
  const userId = await getCurrentUserId();
  if (!userId) return { status: "error", message: AUTH_COPY.resetPassword.sessionExpired, code: "session-expired" };

  const validation = validateNewPassword(formData);
  if (!validation.ok) return { status: "error", message: AUTH_COPY.validation.summary, fieldErrors: validation.errors };

  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser({ password: validation.value.password });
  const outcome = passwordUpdateOutcome(error);
  const requestId = await correlationId();
  logEvent(outcome === "unavailable" ? "error" : "info", "auth.password_update", { correlationId: requestId, outcome, errorCode: error?.code ?? null });

  switch (outcome) {
    case "weak-password": return { status: "error", message: AUTH_COPY.validation.summary, fieldErrors: { password: AUTH_COPY.validation.passwordLettersDigits } };
    case "same-password": return { status: "error", message: AUTH_COPY.validation.summary, fieldErrors: { password: AUTH_COPY.resetPassword.samePassword } };
    case "session-expired": return { status: "error", message: AUTH_COPY.resetPassword.sessionExpired, code: "session-expired" };
    case "unavailable": return { status: "error", message: AUTH_COPY.unavailable };
    case "updated": break;
  }

  await recordAuthEvent(supabase, "auth.password_reset_completed", { method: "recovery_link", correlation_id: requestId });
  // End every session (including a possible attacker's) and ask for a fresh sign-in.
  await supabase.auth.signOut({ scope: "global" });
  redirect("/entrar?senha=atualizada");
}

/** POST-only by construction (Server Action). */
export async function signOutAction(): Promise<void> {
  const supabase = await getSupabase();
  const userId = await getCurrentUserId();
  if (userId) await recordAuthEvent(supabase, "auth.sign_out", { correlation_id: await correlationId() });
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) logEvent("warn", "auth.sign_out_failed", { errorCode: error.code ?? null });
  redirect("/entrar?saiu=1");
}
