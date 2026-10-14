/**
 * MailAdapter (ADR 0021): everything the product asks of an e-mail provider, in its own terms. One
 * implementation, Resend over `fetch` (`resend-adapter.ts`); tests use an object literal. Nothing
 * outside the adapter knows a Resend field, status or error.
 */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Same key, same e-mail: a retry after a timeout does not send it twice. The outbox id. */
  idempotencyKey: string;
  /** Short ASCII label for the provider's dashboard, never personal data (the kind of notice). */
  tag: string;
}

export type MailFailure = "unavailable" | "rejected";

export class MailError extends Error {
  constructor(readonly kind: MailFailure, readonly providerCode: string | null = null) {
    super(`Mail provider call failed: ${kind}`);
    this.name = "MailError";
  }
}

export interface MailAdapter {
  readonly provider: "resend";
  /** Resolves with the provider's id for the message. `unavailable`: try later; `rejected`: do not. */
  send(mail: OutgoingMail): Promise<{ id: string | null }>;
}
