import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cache } from "react";
import { BILLING_COPY } from "@/content/pt-BR";
import { appUrl } from "@/lib/app-url";
import type { Database } from "@/lib/database.types";
import { PRODUCT, type PlanId } from "@/lib/product";
import { supabasePublicConfig } from "@/lib/supabase/config";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { getSupabase, supabaseIdentity } from "@/modules/identity/session";
import { isBillingInterval, isPlanId } from "./catalog";
import type { WorkspaceUsage } from "./downgrade-impact";
import { billingSecrets, resolveBillingMode } from "./mode";
import { billingErrorFromDatabase, pickCurrentSubscription, toInvoiceView, toSubscriptionRecord, type InvoiceView, type WorkspaceBilling } from "./read";
import { createBillingService, parseApplyOutcome, parseMaintenanceTick, runBillingMaintenance, type BillingRepository, type MaintenanceReport, type SnapshotSink, type SyncDeps } from "./service";
import { createStripeAdapter } from "./stripe-adapter";

const SNAPSHOT_TIMEOUT_MS = 6000;
// PostgREST: the function is not in the schema cache, that is, the migration is not applied yet.
const FUNCTION_MISSING = new Set(["PGRST202", "42883"]);

/**
 * The database side of the snapshot path. Acts as `anon` (publishable key, no cookies, no secret
 * key): the only thing it can do is call the attested RPC, and the signature is what authorizes it.
 */
export function createSnapshotSink(): SnapshotSink {
  const { url, publishableKey } = supabasePublicConfig();
  const client = createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS) }) },
  });
  return {
    async apply(payload, signature) {
      const { data, error } = await client.rpc("apply_billing_snapshot", { p_payload: payload, p_signature: signature });
      if (error) {
        if (FUNCTION_MISSING.has(error.code)) return { status: "not_deployed", planChanged: false, slugs: [] };
        throw new Error(`Billing snapshot failed: ${error.code}`);
      }
      return parseApplyOutcome(data);
    },
  };
}

/** Provider + database + clock for this environment, or null when billing is off. */
export function configuredSync(): SyncDeps | null {
  const secrets = billingSecrets();
  if (!secrets) return null;
  return {
    adapter: createStripeAdapter({ secretKey: secrets.providerKey, webhookSecret: secrets.webhookSecret, apiBaseUrl: secrets.apiBaseUrl }),
    sink: createSnapshotSink(),
    signingSecret: secrets.signingSecret,
    now: () => new Date(),
  };
}

/** Runs as the signed-in user: every RPC below re-derives the caller and checks the owner role. */
export function createSupabaseBillingRepository(supabase: SupabaseServerClient): BillingRepository {
  return {
    async workspaceName(workspaceId) {
      const { data } = await supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
      return data?.name ?? null;
    },

    async beginCheckout(workspaceId, planId, interval) {
      const { error } = await supabase.rpc("begin_billing_checkout", { p_workspace_id: workspaceId, p_plan_id: planId, p_interval: interval });
      return error ? { ok: false, error: billingErrorFromDatabase(error) } : { ok: true, value: null };
    },

    async findCustomerId(workspaceId) {
      const { data, error } = await supabase.from("billing_customers").select("provider_customer_id").eq("workspace_id", workspaceId).maybeSingle();
      if (error && !isMissingSchemaError(error)) throw new Error(`Billing customer lookup failed: ${error.code}`);
      return data?.provider_customer_id ?? null;
    },

    async registerCustomer(workspaceId, customerId, signature) {
      const { data, error } = await supabase.rpc("register_billing_customer", { p_workspace_id: workspaceId, p_customer_id: customerId, p_signature: signature });
      if (error) return { ok: false, error: billingErrorFromDatabase(error) };
      return typeof data === "string" && data.length > 0 ? { ok: true, value: data } : { ok: false, error: "unavailable" };
    },

    async beginChange(workspaceId, kind, planId) {
      const { data, error } = await supabase.rpc("begin_billing_change", { p_workspace_id: workspaceId, p_kind: kind, ...(planId ? { p_plan_id: planId } : {}) }).maybeSingle();
      if (error) return { ok: false, error: billingErrorFromDatabase(error) };
      if (!data || !isBillingInterval(data.billing_interval)) return { ok: false, error: "unavailable" };
      return { ok: true, value: { subscriptionId: data.provider_subscription_id, customerId: data.provider_customer_id, planId: data.plan_id, interval: data.billing_interval, amountCents: data.amount_cents } };
    },
  };
}

/** Request-scoped billing service acting as the signed-in user. */
export async function getBillingService() {
  const supabase = await getSupabase();
  return createBillingService({
    identity: supabaseIdentity(supabase),
    repository: createSupabaseBillingRepository(supabase),
    mode: resolveBillingMode().mode,
    sync: configuredSync(),
    appUrl,
    productName: (planId) => `${PRODUCT.codename} ${BILLING_COPY.planNames[planId]}`,
    newId: randomUUID,
  });
}

const SUBSCRIPTION_COLUMNS = "plan_id, billing_interval, amount_cents, status, current_period_end, cancel_at_period_end, grace_until, held_plan_id, held_until, created_at";
const INVOICE_LIST_LIMIT = 24;

/**
 * What the billing screens and the banner show: the workspace's plan and the stored copy of its
 * subscription, read as the signed-in user. RLS decides what comes back: owners and admins see the
 * subscription, only owners see invoices, editors see neither. One query for the plan, one for the
 * subscription, and one more only when invoices are asked for. Deduplicated per request.
 */
export const fetchWorkspaceBilling = cache(async (workspaceId: string, withInvoices = false): Promise<WorkspaceBilling> => {
  const supabase = await getSupabase();
  const { data: workspace, error: workspaceError } = await supabase.from("workspaces").select("plan_id").eq("id", workspaceId).maybeSingle();
  if (workspaceError) throw new Error(`Workspace plan lookup failed: ${workspaceError.code}`);
  const planId: PlanId = workspace && isPlanId(workspace.plan_id) ? workspace.plan_id : "free";

  const { data: rows, error } = await supabase.from("billing_subscriptions").select(SUBSCRIPTION_COLUMNS).eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5);
  if (error) {
    if (isMissingSchemaError(error)) return { deployed: false, planId, record: null, amountCents: null, invoices: [] };
    throw new Error(`Subscription lookup failed: ${error.code}`);
  }
  const current = pickCurrentSubscription(rows);

  let invoices: InvoiceView[] = [];
  if (withInvoices) {
    const { data: invoiceRows, error: invoiceError } = await supabase
      .from("billing_invoices").select("id, amount_cents, status, issued_at, paid_at, receipt_url").eq("workspace_id", workspaceId)
      .order("issued_at", { ascending: false }).limit(INVOICE_LIST_LIMIT);
    if (invoiceError) throw new Error(`Invoice lookup failed: ${invoiceError.code}`);
    invoices = invoiceRows.map(toInvoiceView).filter((invoice): invoice is InvoiceView => invoice !== null);
  }
  return { deployed: true, planId, record: current ? toSubscriptionRecord(current) : null, amountCents: current?.amount_cents ?? null, invoices };
});

/** Today's usage of a workspace, for the list of what a cheaper plan would block (owner's session). */
export async function fetchWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
  const supabase = await getSupabase();
  const now = new Date().toISOString();
  const [pages, members, invitations, links, storage] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("workspace_memberships").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "active"),
    supabase.from("workspace_invitations").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("accepted_at", null).is("revoked_at", null).gt("expires_at", now),
    supabase.from("report_links").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("revoked_at", null).gt("expires_at", now),
    supabase.rpc("workspace_storage_usage", { p_workspace_id: workspaceId }).maybeSingle(),
  ]);
  for (const result of [pages, members, invitations, links, storage]) {
    if (result.error) throw new Error(`Workspace usage lookup failed: ${result.error.code}`);
  }
  return {
    pages: pages.count ?? 0, members: members.count ?? 0, pendingInvitations: invitations.count ?? 0,
    activeReportLinks: links.count ?? 0, storageBytes: Number(storage.data?.used_bytes ?? 0),
  };
}

export type BillingMaintenanceResult = { kind: "not_configured" } | { kind: "not_deployed" } | { kind: "done"; report: MaintenanceReport };

/**
 * Job wiring (ADR 0014). Like the other jobs it has no signed-in user and is the one place billing
 * code uses the secret key, to call a function only the service role may execute. The snapshots
 * the job produces still go through the attested door, like every other one.
 */
export async function runConfiguredBillingMaintenance(): Promise<BillingMaintenanceResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return { kind: "not_configured" };
  const client = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  let missing = false;
  const report = await runBillingMaintenance({
    sync: configuredSync(),
    async tick() {
      const { data, error } = await client.rpc("run_billing_maintenance");
      if (error) {
        if (FUNCTION_MISSING.has(error.code)) {
          missing = true;
          return parseMaintenanceTick(null);
        }
        throw new Error(`Billing maintenance failed: ${error.code}`);
      }
      return parseMaintenanceTick(data);
    },
  });
  return missing ? { kind: "not_deployed" } : { kind: "done", report };
}
