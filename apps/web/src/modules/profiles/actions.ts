"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APP_COPY } from "@/content/pt-BR";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { revalidatePublicPage } from "@/modules/publishing/cache";
import { getProfileService } from "./server";
import type { CommandResult, DraftSnapshot, ProfileField } from "./service";
import type { SlugValidation } from "./slug";

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function logCommand(event: string, result: CommandResult<unknown>): Promise<void> {
  const correlationId = correlationIdFrom((await headers()).get(CORRELATION_HEADER));
  logEvent(result.ok ? "info" : result.error === "unavailable" ? "error" : "warn", event, { correlationId, outcome: result.ok ? "ok" : result.error });
}

function toFormState<T>(result: CommandResult<T>, values: Partial<Record<ProfileField, string>>): FormState<ProfileField> {
  if (result.ok) return { status: "success" };
  return { status: "error", message: result.message, fieldErrors: result.fieldErrors, values, code: result.error };
}

/**
 * `workspaceId` / `profileId` arrive bound from the page but are client-controlled payload: the
 * service re-authorizes them against the caller's memberships on every call.
 */
export async function createProfileAction(workspaceId: string, _previous: FormState, formData: FormData): Promise<FormState<ProfileField>> {
  const values = { title: stringField(formData, "title"), bio: stringField(formData, "bio"), slug: stringField(formData, "slug") };
  const service = await getProfileService();
  const result = await service.create(workspaceId, values);
  await logCommand("profile.create", result);
  if (!result.ok) return toFormState(result, values);
  redirect(`/app/w/${result.value.workspaceId}?criada=1`);
}

export type SaveDraftResult =
  | { ok: true; revision: number }
  | { ok: false; error: "conflict" | "validation" | "forbidden" | "not_found" | "unauthenticated" | "unavailable" };

function saveError(result: Extract<CommandResult<unknown>, { ok: false }>): Extract<SaveDraftResult, { ok: false }>["error"] {
  switch (result.error) {
    case "conflict":
    case "forbidden":
    case "not_found":
    case "unauthenticated":
    case "validation":
      return result.error;
    case "content_invalid":
      return "validation";
    default:
      return "unavailable";
  }
}

/**
 * Editor autosave. The payload is client-controlled: the service re-authorizes the page and
 * validates every block like the database. No refresh(): the editor keeps its own state, and
 * re-rendering the page on every keystroke would be wasteful. Logs carry the outcome only, never
 * block content or phone numbers.
 */
export async function saveDraftAction(profileId: string, payload: unknown): Promise<SaveDraftResult> {
  const startedAt = performance.now();
  const correlationId = correlationIdFrom((await headers()).get(CORRELATION_HEADER));
  let result: CommandResult<{ revision: number }>;
  try {
    result = await (await getProfileService()).saveDraft(profileId, payload);
  } catch {
    result = { ok: false, error: "unavailable", message: APP_COPY.errors.unavailable };
  }
  const outcome = result.ok ? "ok" : saveError(result);
  logEvent(outcome === "ok" ? "info" : outcome === "unavailable" ? "error" : "warn", "editor.save", { correlationId, outcome, durationMs: Math.round(performance.now() - startedAt) });
  return result.ok ? { ok: true, revision: result.value.revision } : { ok: false, error: saveError(result) };
}

export type LoadDraftResult = { ok: true; draft: DraftSnapshot } | { ok: false };

/** Latest saved draft, for "Carregar a versão mais recente" and "Manter as minhas alterações". */
export async function loadDraftAction(profileId: string): Promise<LoadDraftResult> {
  let result: CommandResult<DraftSnapshot>;
  try {
    result = await (await getProfileService()).loadDraft(profileId);
  } catch {
    result = { ok: false, error: "unavailable", message: APP_COPY.errors.unavailable };
  }
  await logCommand("editor.load_latest", result);
  return result.ok ? { ok: true, draft: result.value } : { ok: false };
}

export async function changeProfileSlugAction(profileId: string, _previous: FormState, formData: FormData): Promise<FormState<ProfileField>> {
  const values = { slug: stringField(formData, "slug") };
  const service = await getProfileService();
  const previousSlug = await service.currentSlug(profileId);
  const result = await service.changeSlug(profileId, values.slug);
  await logCommand("profile.change_slug", result);
  if (!result.ok) return toFormState(result, values);
  // The old address now redirects and the new one serves the page: drop both cached copies.
  if (previousSlug) revalidatePublicPage(previousSlug);
  revalidatePublicPage(result.value);
  refresh();
  return { status: "success", message: APP_COPY.slugChange.changed(result.value) };
}

export async function deleteProfileAction(profileId: string): Promise<FormState<ProfileField>> {
  const result = await (await getProfileService()).softDelete(profileId);
  await logCommand("profile.soft_delete", result);
  if (!result.ok) return toFormState(result, {});
  revalidatePublicPage(result.value.slug);
  redirect(`/app/w/${result.value.workspaceId}?excluida=1`);
}

/** Debounced availability check used while typing an address. */
export async function checkSlugAction(slug: string, workspaceId: string | null): Promise<SlugValidation> {
  return (await getProfileService()).checkSlug(slug, workspaceId);
}
