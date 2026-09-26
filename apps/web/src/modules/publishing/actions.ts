"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { PUBLISHING_COPY } from "@/content/pt-BR";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent, type LogFields } from "@/lib/observability/logger";
import { revalidatePublicPage } from "./cache";
import { getPublishingService } from "./server";
import type { PublishingResult } from "./service";

async function logCommand(event: string, result: PublishingResult<unknown>, startedAt: number, fields: LogFields = {}): Promise<void> {
  const correlationId = correlationIdFrom((await headers()).get(CORRELATION_HEADER));
  logEvent(result.ok ? "info" : result.error === "unavailable" ? "error" : "warn", event, {
    correlationId,
    outcome: result.ok ? "ok" : result.error,
    durationMs: Math.round(performance.now() - startedAt),
    ...fields,
  });
}

function toFormState(result: PublishingResult<unknown>, message: string): FormState {
  return result.ok ? { status: "success", message } : { status: "error", message: result.message, code: result.error };
}

/**
 * Invalidates the cached public page right after the database commit, so the new version is served
 * on the next request (acceptance: visible within 30 seconds). The 60 s ISR window is only the
 * fallback when this call is skipped (e.g. a suspension applied directly in the database).
 */
function invalidatePublicPage(slug: string): void {
  revalidatePublicPage(slug);
  refresh();
}

/** `profileId` is bound by the page but is client-controlled: the service re-authorizes it. */
export async function publishProfileAction(profileId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const startedAt = performance.now();
  const result = await (await getPublishingService()).publish(profileId, formData.get("expectedRevision"));
  await logCommand("publishing.publish", result, startedAt, result.ok ? { version: result.value.version, created: result.value.created } : {});
  if (!result.ok) return toFormState(result, "");
  invalidatePublicPage(result.value.slug);
  return toFormState(result, result.value.created ? PUBLISHING_COPY.published(result.value.version) : PUBLISHING_COPY.alreadyPublished);
}

export async function restorePublicationAction(profileId: string, publicationId: string): Promise<FormState> {
  const startedAt = performance.now();
  const result = await (await getPublishingService()).restore(profileId, publicationId);
  await logCommand("publishing.restore", result, startedAt, result.ok ? { version: result.value.version } : {});
  if (!result.ok) return toFormState(result, "");
  invalidatePublicPage(result.value.slug);
  return toFormState(result, PUBLISHING_COPY.restored(result.value.version));
}

export async function unpublishProfileAction(profileId: string): Promise<FormState> {
  const startedAt = performance.now();
  const result = await (await getPublishingService()).unpublish(profileId);
  await logCommand("publishing.unpublish", result, startedAt);
  if (!result.ok) return toFormState(result, "");
  invalidatePublicPage(result.value.slug);
  return toFormState(result, PUBLISHING_COPY.unpublish.done);
}
