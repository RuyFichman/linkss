import { AUTH_COPY as PORTUGUESE_AUTH_COPY } from "@/content/pt-BR";
import type { SignUpCopy } from "@/content/types";

/** Validation messages in one language (ADR 0022); Portuguese by default. */
type Messages = SignUpCopy["validation"];

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt ignores input beyond 72 bytes; reject instead of silently truncating.
export const PASSWORD_MAX_LENGTH = 72;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldErrors<Field extends string> = Partial<Record<Field, string>>;
export type Validation<Value, Field extends string> = { ok: true; value: Value } | { ok: false; errors: FieldErrors<Field> };

function field(formData: FormData, name: string): string {
  const entry = formData.get(name);
  return typeof entry === "string" ? entry : "";
}

export function emailError(email: string, messages: Messages = PORTUGUESE_AUTH_COPY.validation): string | undefined {
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return messages.email;
  return undefined;
}

/** Mirrors supabase/config.toml: minimum_password_length = 8, password_requirements = letters_digits. */
export function passwordError(password: string, messages: Messages = PORTUGUESE_AUTH_COPY.validation): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) return messages.passwordTooShort;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) return messages.passwordTooLong;
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return messages.passwordLettersDigits;
  return undefined;
}

function done<Value, Field extends string>(value: Value, errors: FieldErrors<Field>): Validation<Value, Field> {
  return Object.values(errors).some(Boolean) ? { ok: false, errors } : { ok: true, value };
}

export type SignUpField = "name" | "email" | "password";
export function validateSignUp(formData: FormData, messages: Messages = PORTUGUESE_AUTH_COPY.validation): Validation<{ name: string; email: string; password: string }, SignUpField> {
  const name = field(formData, "name").trim().replace(/\s+/g, " ");
  const email = field(formData, "email").trim().toLowerCase();
  const password = field(formData, "password");
  return done({ name, email, password }, {
    name: name.length < 2 || name.length > 80 ? messages.name : undefined,
    email: emailError(email, messages),
    password: passwordError(password, messages),
  });
}

export type SignInField = "email" | "password";
export function validateSignIn(formData: FormData, messages: Messages = PORTUGUESE_AUTH_COPY.validation): Validation<{ email: string; password: string }, SignInField> {
  const email = field(formData, "email").trim().toLowerCase();
  const password = field(formData, "password");
  return done({ email, password }, {
    email: emailError(email, messages),
    password: password ? undefined : messages.passwordRequired,
  });
}

export type EmailOnlyField = "email";
export function validateEmailOnly(formData: FormData, messages: Messages = PORTUGUESE_AUTH_COPY.validation): Validation<{ email: string }, EmailOnlyField> {
  const email = field(formData, "email").trim().toLowerCase();
  return done({ email }, { email: emailError(email, messages) });
}

export type NewPasswordField = "password" | "confirmation";
export function validateNewPassword(formData: FormData, messages: Messages = PORTUGUESE_AUTH_COPY.validation): Validation<{ password: string }, NewPasswordField> {
  const password = field(formData, "password");
  const confirmation = field(formData, "confirmation");
  const passwordProblem = passwordError(password, messages);
  return done({ password }, {
    password: passwordProblem,
    confirmation: !passwordProblem && password !== confirmation ? messages.passwordMismatch : undefined,
  });
}
