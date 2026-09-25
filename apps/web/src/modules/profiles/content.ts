import { APP_COPY } from "@/content/pt-BR";

export const TITLE_MAX_LENGTH = 80;
export const BIO_MAX_LENGTH = 280;

export type ProfileContentField = "title" | "bio";
export type ProfileContentValidation =
  | { ok: true; value: { title: string; bio: string } }
  | { ok: false; errors: Partial<Record<ProfileContentField, string>> };

/** Mirrors the profiles table checks (title 1–80 after trim, bio ≤ 280). */
export function validateProfileContent(input: { title: unknown; bio: unknown }): ProfileContentValidation {
  const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
  const bio = typeof input.bio === "string" ? input.bio.trim().replace(/\r\n/g, "\n") : "";
  const errors: Partial<Record<ProfileContentField, string>> = {};
  if (title.length < 1 || title.length > TITLE_MAX_LENGTH) errors.title = APP_COPY.profileForm.titleError;
  if (bio.length > BIO_MAX_LENGTH) errors.bio = APP_COPY.profileForm.bioError;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { title, bio } };
}

/** Up to two initials for the avatar placeholder (no upload until Sprint 5). */
export function initialsFor(title: string): string {
  const words = title.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const letters = words.slice(0, 2).map((word) => [...word.replace(/[^\p{L}\p{N}]/gu, "")][0] ?? "");
  return letters.join("").toLocaleUpperCase("pt-BR") || "?";
}
