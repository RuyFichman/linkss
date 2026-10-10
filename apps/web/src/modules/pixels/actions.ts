"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { PIXELS_COPY } from "@/content/pt-BR";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { revalidatePublicPage } from "@/modules/publishing/cache";
import type { PixelField } from "./model";
import { getPixelsService } from "./server";

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export type PixelsFormState = FormState<PixelField>;

/** `profileId` arrives bound from the page but is client-controlled: the service and the database re-authorize it. */
export async function setPixelsAction(profileId: string, _previous: PixelsFormState, formData: FormData): Promise<PixelsFormState> {
  const values = { meta: stringField(formData, "meta"), ga: stringField(formData, "ga") };
  const result = await (await getPixelsService()).set(profileId, values);
  const correlationId = correlationIdFrom((await headers()).get(CORRELATION_HEADER));
  // Outcome only: identifiers are not logged.
  logEvent(result.ok ? "info" : result.error === "unavailable" ? "error" : "warn", "pixels.set", { correlationId, outcome: result.ok ? "ok" : result.error });
  if (!result.ok) {
    return {
      status: "error", message: PIXELS_COPY.errors[result.error], values, code: result.error,
      ...(result.field ? { fieldErrors: { [result.field]: PIXELS_COPY.fieldErrors[result.field] } } : {}),
    };
  }
  if (result.value.isLive) revalidatePublicPage(result.value.slug);
  refresh();
  return { status: "success", message: PIXELS_COPY.form.saved, values };
}
