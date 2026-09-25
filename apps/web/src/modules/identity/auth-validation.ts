import { AUTH_COPY } from "@/content/pt-BR";

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

export function emailError(email: string): string | undefined {
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return AUTH_COPY.validation.email;
  return undefined;
}

/** Mirrors supabase/config.toml: minimum_password_length = 8, password_requirements = letters_digits. */
export function passwordError(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) return AUTH_COPY.validation.passwordTooShort;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) return AUTH_COPY.validation.passwordTooLong;
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return AUTH_COPY.validation.passwordLettersDigits;
  return undefined;
}

function done<Value, Field extends string>(value: Value, errors: FieldErrors<Field>): Validation<Value, Field> {
  return Object.values(errors).some(Boolean) ? { ok: false, errors } : { ok: true, value };
}

export type SignUpField = "name" | "email" | "password";
export function validateSignUp(formData: FormData): Validation<{ name: string; email: string; password: string }, SignUpField> {
  const name = field(formData, "name").trim().replace(/\s+/g, " ");
  const email = field(formData, "email").trim().toLowerCase();
  const password = field(formData, "password");
  return done({ name, email, password }, {
    name: name.length < 2 || name.length > 80 ? AUTH_COPY.validation.name : undefined,
    email: emailError(email),
    password: passwordError(password),
  });
}

export type SignInField = "email" | "password";
export function validateSignIn(formData: FormData): Validation<{ email: string; password: string }, SignInField> {
  const email = field(formData, "email").trim().toLowerCase();
  const password = field(formData, "password");
  return done({ email, password }, {
    email: emailError(email),
    password: password ? undefined : AUTH_COPY.validation.passwordRequired,
  });
}

export type EmailOnlyField = "email";
export function validateEmailOnly(formData: FormData): Validation<{ email: string }, EmailOnlyField> {
  const email = field(formData, "email").trim().toLowerCase();
  return done({ email }, { email: emailError(email) });
}

export type NewPasswordField = "password" | "confirmation";
export function validateNewPassword(formData: FormData): Validation<{ password: string }, NewPasswordField> {
  const password = field(formData, "password");
  const confirmation = field(formData, "confirmation");
  const passwordProblem = passwordError(password);
  return done({ password }, {
    password: passwordProblem,
    confirmation: !passwordProblem && password !== confirmation ? AUTH_COPY.validation.passwordMismatch : undefined,
  });
}
