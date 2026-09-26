"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APP_COPY } from "@/content/pt-BR";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { getProfileService } from "./server";
import type { CommandResult, ProfileField } from "./service";
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

export async function updateProfileContentAction(profileId: string, _previous: FormState, formData: FormData): Promise<FormState<ProfileField>> {
  const values = { title: stringField(formData, "title"), bio: stringField(formData, "bio") };
  const result = await (await getProfileService()).updateContent(profileId, values);
  await logCommand("profile.update_content", result);
  if (!result.ok) return toFormState(result, values);
  refresh();
  return { status: "success", message: APP_COPY.profileForm.saved };
}

export async function changeProfileSlugAction(profileId: string, _previous: FormState, formData: FormData): Promise<FormState<ProfileField>> {
  const values = { slug: stringField(formData, "slug") };
  const result = await (await getProfileService()).changeSlug(profileId, values.slug);
  await logCommand("profile.change_slug", result);
  if (!result.ok) return toFormState(result, values);
  refresh();
  return { status: "success", message: APP_COPY.slugChange.changed(result.value) };
}

export async function deleteProfileAction(profileId: string): Promise<FormState<ProfileField>> {
  const result = await (await getProfileService()).softDelete(profileId);
  await logCommand("profile.soft_delete", result);
  if (!result.ok) return toFormState(result, {});
  redirect(`/app/w/${result.value.workspaceId}?excluida=1`);
}

/** Debounced availability check used while typing an address. */
export async function checkSlugAction(slug: string, workspaceId: string | null): Promise<SlugValidation> {
  return (await getProfileService()).checkSlug(slug, workspaceId);
}
