import { supportEmailFrom } from "@/lib/support";

/**
 * Whether this environment sends e-mail, and with what (ADR 0021). Server-only. Everything
 * missing or malformed answers `off` with a reason: messages then wait in the outbox and expire,
 * and nothing errors. The reason is logged by the mail job, never a value.
 *
 *   RESEND_API_KEY      the provider key (`re_...`)
 *   MAIL_FROM           sender on a domain verified at Resend: `Linkfav <avisos@linkfav.com>`
 *   MAIL_REPLY_TO       optional; defaults to SUPPORT_EMAIL; without either the e-mail says not to reply
 *   RESEND_API_BASE_URL loopback address of a local stand-in, never in production
 */
export type MailConfig =
  | { mode: "on"; apiKey: string; from: string; replyTo: string | null; apiBaseUrl: string | null }
  | { mode: "off"; reason: "missing_api_key" | "missing_from" | "invalid_from" | "base_url_not_allowed" };

const FROM = /^(?:[^<>@"\r\n]{1,60} )?<[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}>$|^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;
const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

type Env = Record<string, string | undefined>;

export function resolveMailConfig(env: Env = process.env): MailConfig {
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (!/^re_[A-Za-z0-9_]{16,}$/.test(apiKey)) return { mode: "off", reason: "missing_api_key" };
  const from = (env.MAIL_FROM ?? "").trim();
  if (from === "") return { mode: "off", reason: "missing_from" };
  if (!FROM.test(from)) return { mode: "off", reason: "invalid_from" };
  const baseUrl = (env.RESEND_API_BASE_URL ?? "").trim();
  if (baseUrl !== "" && (!LOOPBACK_URL.test(baseUrl) || env.VERCEL_ENV === "production")) return { mode: "off", reason: "base_url_not_allowed" };
  const replyTo = supportEmailFrom(env.MAIL_REPLY_TO) ?? supportEmailFrom(env.SUPPORT_EMAIL);
  return { mode: "on", apiKey, from, replyTo, apiBaseUrl: baseUrl || null };
}
