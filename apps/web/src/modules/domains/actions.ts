"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { DOMAINS_COPY } from "@/content/pt-BR";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { revalidatePublicPage } from "@/modules/publishing/cache";
import { getDomainsService } from "./server";
import type { DomainCommandError } from "./service";

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Outcome only. Hostnames are public names, but the trail of who claimed what lives in the audit log, not here. */
async function logCommand(event: string, outcome: string, extra: Record<string, string | boolean> = {}): Promise<void> {
  const correlationId = correlationIdFrom((await headers()).get(CORRELATION_HEADER));
  const level = outcome === "ok" ? "info" : outcome === "unavailable" || outcome === "not_configured" || outcome === "dns_unavailable" ? "error" : "warn";
  logEvent(level, event, { correlationId, outcome, ...extra });
}

function errorMessage(error: DomainCommandError): string {
  return DOMAINS_COPY.errors[error];
}

export type DomainFormState = FormState<"hostname">;

/** `profileId` arrives bound from the page but is client-controlled: the service and the database re-authorize it. */
export async function claimDomainAction(profileId: string, _previous: DomainFormState, formData: FormData): Promise<DomainFormState> {
  const hostname = stringField(formData, "hostname");
  const result = await (await getDomainsService()).claim(profileId, hostname);
  await logCommand("domains.claim", result.ok ? "ok" : result.error);
  if (!result.ok) {
    const field = result.error === "empty" || result.error === "invalid" || result.error === "blocked";
    return { status: "error", message: errorMessage(result.error), values: { hostname }, code: result.error, ...(field ? { fieldErrors: { hostname: errorMessage(result.error) } } : {}) };
  }
  refresh();
  return { status: "success", message: DOMAINS_COPY.claim.done };
}

export async function verifyDomainAction(domainId: string): Promise<FormState> {
  const result = await (await getDomainsService()).verify(domainId);
  if (!result.ok) {
    await logCommand("domains.verify", result.error);
    return { status: "error", message: errorMessage(result.error), code: result.error };
  }
  const { status, slugs, routing, providerFailed } = result.value;
  await logCommand("domains.verify", "ok", { status, routing: routing?.state ?? "none", providerFailed });
  for (const slug of slugs) revalidatePublicPage(slug);
  refresh();
  const copy = DOMAINS_COPY.verify;
  if (status === "dns_missing") return { status: "error", message: copy.dnsMissing, code: status };
  if (status === "in_use") return { status: "error", message: copy.inUse, code: status };
  if (status === "not_in_plan") return { status: "error", message: DOMAINS_COPY.errors.not_in_plan, code: status };
  if (providerFailed) return { status: "success", message: copy.provenProviderFailed, code: "provider_failed" };
  if (!routing) return { status: "success", message: copy.provenNoProvider, code: "no_provider" };
  if (routing.state === "conflict") return { status: "success", message: copy.provenConflict, code: "conflict" };
  return { status: "success", message: routing.state === "ok" ? copy.live : copy.provenPointDns, code: routing.state };
}

export async function removeDomainAction(domainId: string): Promise<FormState> {
  const result = await (await getDomainsService()).remove(domainId);
  if (!result.ok) {
    await logCommand("domains.remove", result.error);
    return { status: "error", message: errorMessage(result.error), code: result.error };
  }
  // `detached: false` with a provider configured leaves the hostname attached there: harmless (no row, no page), but worth cleaning up.
  await logCommand("domains.remove", "ok", { wasActive: result.value.wasActive, detached: result.value.detached });
  if (result.value.slug) revalidatePublicPage(result.value.slug);
  refresh();
  return { status: "success", message: DOMAINS_COPY.remove.done };
}
