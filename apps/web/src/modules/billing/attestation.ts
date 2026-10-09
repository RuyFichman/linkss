import { createHmac } from "node:crypto";
import type { PaymentsProvider, ProviderInvoice, ProviderSubscription } from "./adapter";

/**
 * Billing attestation (ADR 0014), the same pattern as uploads (ADR 0009) and analytics (ADR 0011).
 * The server signs the exact text it sends to the database; the database recomputes the HMAC with
 * the same secret from Supabase Vault (`billing_signing_secret`). A direct call to the RPCs with a
 * publishable key or a user session has no valid signature, so nobody can write a subscription, a
 * plan or a customer mapping around the server. The secret attests; it grants no access to data.
 */
export const BILLING_SNAPSHOT_VERSION = 1;
export const MAX_SNAPSHOT_INVOICES = 12;

/** Why a snapshot was produced. Goes to the ledger and the audit trail; never decides anything. */
export const SNAPSHOT_REASONS = ["webhook", "checkout_return", "owner_action", "reconciliation", "dispute"] as const;
export type SnapshotReason = (typeof SNAPSHOT_REASONS)[number];

export interface BillingSnapshot {
  provider: PaymentsProvider;
  /** Idempotency key of this write: the provider's event id, or one made by the server for its own reads. */
  eventId: string;
  reason: SnapshotReason;
  /** When the server read the provider. A snapshot older than the stored one changes nothing. */
  observedAt: Date;
  customerId: string;
  subscription: ProviderSubscription | null;
  invoices: readonly ProviderInvoice[];
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** The signed text. Key order is fixed so the same snapshot always serializes the same way. */
export function serializeBillingSnapshot(snapshot: BillingSnapshot): string {
  const subscription = snapshot.subscription;
  return JSON.stringify({
    v: BILLING_SNAPSHOT_VERSION,
    provider: snapshot.provider,
    event_id: snapshot.eventId,
    reason: snapshot.reason,
    observed_at: snapshot.observedAt.toISOString(),
    customer_id: snapshot.customerId,
    subscription: subscription
      ? {
          id: subscription.id,
          customer_id: subscription.customerId,
          workspace_id: subscription.workspaceId,
          status: subscription.status,
          amount_cents: subscription.amountCents,
          currency: subscription.currency.toUpperCase(),
          interval: subscription.interval,
          current_period_end: iso(subscription.currentPeriodEnd),
          cancel_at_period_end: subscription.cancelAtPeriodEnd,
        }
      : null,
    invoices: snapshot.invoices.slice(0, MAX_SNAPSHOT_INVOICES).map((invoice) => ({
      id: invoice.id,
      amount_cents: invoice.amountCents,
      currency: invoice.currency.toUpperCase(),
      status: invoice.status,
      paid_at: iso(invoice.paidAt),
      created_at: invoice.createdAt.toISOString(),
      receipt_url: invoice.receiptUrl,
    })),
  });
}

/** The signed text that binds a provider customer to a workspace (public.register_billing_customer). */
export function customerRegistrationMessage(workspaceId: string, provider: PaymentsProvider, customerId: string): string {
  return `lnk-billing-customer:v1:${workspaceId}:${provider}:${customerId}`;
}

export function signBillingMessage(text: string, secret: string): string {
  return createHmac("sha256", secret).update(text, "utf8").digest("hex");
}
