"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APP_COPY } from "@/content/pt-BR";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { getCurrentUserId, getSupabase } from "./session";
import { validateAgencyName } from "./workspace-validation";

export async function createAgencyWorkspaceAction(_previous: FormState, formData: FormData): Promise<FormState<"name">> {
  const raw = formData.get("name");
  const values = { name: typeof raw === "string" ? raw : "" };
  if (!(await getCurrentUserId())) return { status: "error", message: APP_COPY.errors.sessionExpired, values };

  const validation = validateAgencyName(values.name);
  if (!validation.ok) return { status: "error", message: validation.error, fieldErrors: { name: validation.error }, values };

  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("create_agency_workspace", { p_name: validation.value });
  const correlationId = correlationIdFrom((await headers()).get(CORRELATION_HEADER));
  logEvent(error ? "warn" : "info", "workspace.create_agency", { correlationId, outcome: error ? error.code : "ok" });
  if (error?.code === "LK050") return { status: "error", message: APP_COPY.workspace.agencyLimit, values };
  if (error?.code === "23514") return { status: "error", message: APP_COPY.workspace.agencyNameError, fieldErrors: { name: APP_COPY.workspace.agencyNameError }, values };
  if (error || !data) return { status: "error", message: APP_COPY.errors.unavailable, values };
  redirect(`/app/w/${data}`);
}
