import { MailError, type MailAdapter } from "./adapter";

/**
 * Resend behind the MailAdapter (ADR 0021). One call, `POST /emails`, over `fetch` with no SDK:
 * the API key in the Authorization header, the outbox id as `Idempotency-Key` (Resend keeps it for
 * 24 hours, so a retry of a request whose answer was lost sends nothing new). Written from the
 * public API reference; **never run against Resend** until the founder's account exists.
 */
const RESEND_API_ORIGIN = "https://api.resend.com";
const REQUEST_TIMEOUT_MS = 8000;

export interface ResendAdapterConfig {
  apiKey: string;
  /** `Linkfav <avisos@linkfav.com>`: a sender on a domain verified at Resend. */
  from: string;
  replyTo: string | null;
  /** Loopback stand-in for local checks only (modules/mail/config.ts enforces it). */
  apiBaseUrl?: string | null;
  fetch?: typeof fetch;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createResendAdapter(config: ResendAdapterConfig): MailAdapter {
  const origin = (config.apiBaseUrl ?? RESEND_API_ORIGIN).replace(/\/+$/, "");
  const doFetch = config.fetch ?? fetch;
  return {
    provider: "resend",
    async send(mail) {
      let response: Response;
      try {
        response = await doFetch(`${origin}/emails`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": mail.idempotencyKey },
          body: JSON.stringify({
            from: config.from,
            to: [mail.to],
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            ...(config.replyTo ? { reply_to: config.replyTo } : {}),
            tags: [{ name: "kind", value: mail.tag }],
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: "no-store",
        });
      } catch {
        throw new MailError("unavailable");
      }
      let body: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = await response.json();
        body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
      } catch {
        body = null;
      }
      if (response.ok) return { id: text(body?.id) };
      // Only the machine-readable name leaves this function: the message can quote the address.
      const code = text(body?.name);
      if (response.status === 429 || response.status >= 500) throw new MailError("unavailable", code);
      // 409: the same key is still being processed, or was used with another body. The first case
      // resolves itself; trying later is right for both (the second never happens: the body of an
      // outbox message does not change).
      if (response.status === 409) throw new MailError("unavailable", code);
      throw new MailError("rejected", code);
    },
  };
}
