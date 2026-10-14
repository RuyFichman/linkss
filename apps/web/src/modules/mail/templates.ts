import { MAIL_COPY, MODERATION_COPY, BILLING_COPY } from "@/content/pt-BR";
import { PRODUCT } from "@/lib/product";
import { formatMoney, isPlanId } from "@/modules/billing/catalog";
import { formatBillingDate } from "@/modules/billing/presentation";

/**
 * The words of each e-mail (ADR 0021). Pure: an outbox message in, subject, text and HTML out, or
 * `null` when the message does not have the shape its kind needs (it is then marked failed, never
 * sent half-filled). Every value that came from a person (a page title, an answer of moderation)
 * is escaped in the HTML. The new-contact notice never carries what the visitor typed: the outbox
 * does not have it.
 */
export const MAIL_KINDS = ["new_lead", "page_suspended", "appeal_decided", "payment_failed", "renewal_upcoming"] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

export interface MailContext {
  /** Absolute URL of a path of the application, from configuration. */
  appUrl: (path: string) => string;
  /** The address shown for a public page, e.g. `linkfav.com/cafe`. */
  publicAddress: (slug: string) => string;
  recipientName: string | null;
  /** Whether replies reach a person (MAIL_REPLY_TO or SUPPORT_EMAIL is set). */
  replyReachesSomeone: boolean;
  /** Billing in sandbox: payment notices are about test charges and say so. */
  billingIsTest: boolean;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
  tag: MailKind;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const CATEGORIES = Object.keys(MODERATION_COPY.categories) as (keyof typeof MODERATION_COPY.categories)[];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function title(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200 ? value.trim() : null;
}

function date(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

interface Body {
  subject: string;
  paragraphs: string[];
  /** Quoted text written by a person (an answer of moderation): set apart from our own words. */
  quote?: { intro: string; text: string };
  action: { label: string; path: string };
  extra?: { text: string; label: string; path: string };
}

function compose(body: Body, kind: MailKind, context: MailContext): RenderedMail {
  const copy = MAIL_COPY;
  const actionUrl = context.appUrl(body.action.path);
  const footer = [context.replyReachesSomeone ? copy.footerReply : copy.footerNoReply, copy.footerWhy(PRODUCT.name)];
  const greeting = copy.greeting(context.recipientName);
  const text = [
    greeting, "",
    ...body.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(body.quote ? [body.quote.intro, ...body.quote.text.split("\n").map((line) => `> ${line}`), ""] : []),
    `${body.action.label}: ${actionUrl}`, "",
    ...(body.extra ? [`${body.extra.text} ${body.extra.label}: ${context.appUrl(body.extra.path)}`, ""] : []),
    "--", ...footer,
  ].join("\n");
  const p = (content: string) => `<p style="margin:0 0 16px;line-height:1.5">${content}</p>`;
  const html = [
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(body.subject)}</title></head>`,
    `<body style="margin:0;padding:24px 16px;background:#f5f5f8;color:#1d1d28;font-family:Arial,Helvetica,sans-serif;font-size:16px">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">`,
    `<p style="margin:0 0 16px;font-weight:bold">${escapeHtml(PRODUCT.name)}</p>`,
    p(escapeHtml(greeting)),
    ...body.paragraphs.map((paragraph) => p(escapeHtml(paragraph))),
    ...(body.quote ? [p(escapeHtml(body.quote.intro)), `<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:4px solid #3156d3;background:#f0f0f6;white-space:pre-wrap">${escapeHtml(body.quote.text)}</blockquote>`] : []),
    `<p style="margin:24px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#1d1d28;color:#ffffff;text-decoration:none;font-weight:bold">${escapeHtml(body.action.label)}</a></p>`,
    ...(body.extra ? [p(`${escapeHtml(body.extra.text)} <a href="${escapeHtml(context.appUrl(body.extra.path))}" style="color:#3156d3">${escapeHtml(body.extra.label)}</a>`)] : []),
    `<p style="margin:24px 0 0;color:#5b6072;font-size:13px;line-height:1.5">${footer.map(escapeHtml).join("<br>")}</p>`,
    `</div></body></html>`,
  ].join("");
  return { subject: body.subject, text, html, tag: kind };
}

/** One message of the outbox as an e-mail, or `null` when it cannot be written. */
export function renderMail(kind: string, workspaceId: string | null, payload: unknown, context: MailContext): RenderedMail | null {
  const data = record(payload);
  if (!data || !workspaceId || !UUID.test(workspaceId)) return null;
  const copy = MAIL_COPY;
  const base = `/app/w/${workspaceId}`;

  switch (kind) {
    case "new_lead": {
      const name = title(data.title);
      if (!name || typeof data.profileId !== "string" || !UUID.test(data.profileId) || typeof data.slug !== "string" || !SLUG.test(data.slug)) return null;
      return compose({
        subject: copy.newLead.subject(name),
        paragraphs: [copy.newLead.body(name, context.publicAddress(data.slug)), copy.newLead.detail, copy.newLead.oneAnHour],
        action: { label: copy.newLead.action, path: `${base}/paginas/${data.profileId}/contatos` },
        extra: { text: copy.newLead.optOut, label: copy.newLead.optOutAction, path: "/app/conta/dados#avisos" },
      }, kind, context);
    }
    case "page_suspended": {
      const name = title(data.title);
      const category = CATEGORIES.find((item) => item === data.category);
      if (!name || !category || typeof data.profileId !== "string" || !UUID.test(data.profileId)) return null;
      return compose({
        subject: copy.pageSuspended.subject(name),
        paragraphs: [copy.pageSuspended.body(name, MODERATION_COPY.categories[category]), copy.pageSuspended.kept, copy.pageSuspended.appeal],
        action: { label: copy.pageSuspended.action, path: `${base}/paginas/${data.profileId}/moderacao` },
      }, kind, context);
    }
    case "appeal_decided": {
      const name = title(data.title);
      const response = typeof data.response === "string" && data.response.trim().length > 0 && data.response.length <= 1000 ? data.response.trim() : null;
      if (!name || typeof data.accepted !== "boolean" || !response || typeof data.profileId !== "string" || !UUID.test(data.profileId)) return null;
      return compose({
        subject: data.accepted ? copy.appealDecided.subjectAccepted(name) : copy.appealDecided.subjectDenied(name),
        paragraphs: [data.accepted ? copy.appealDecided.accepted(name) : copy.appealDecided.denied(name)],
        quote: { intro: copy.appealDecided.responseIntro, text: response },
        action: { label: copy.appealDecided.action, path: `${base}/paginas/${data.profileId}/moderacao` },
      }, kind, context);
    }
    case "payment_failed": {
      const until = date(data.graceUntil);
      if (!isPlanId(data.planId) || !until) return null;
      const plan = BILLING_COPY.planNames[data.planId];
      return compose({
        subject: `${context.billingIsTest ? copy.testPrefix : ""}${copy.paymentFailed.subject(plan)}`,
        paragraphs: [copy.paymentFailed.body(plan, formatBillingDate(until)), copy.paymentFailed.fix, ...(context.billingIsTest ? [copy.testNote] : [])],
        action: { label: copy.paymentFailed.action, path: `${base}/plano` },
      }, kind, context);
    }
    case "renewal_upcoming": {
      const renewsAt = date(data.renewsAt);
      const amount = data.amountCents;
      if (!isPlanId(data.planId) || !renewsAt || typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return null;
      const plan = BILLING_COPY.planNames[data.planId];
      const when = formatBillingDate(renewsAt);
      return compose({
        subject: `${context.billingIsTest ? copy.testPrefix : ""}${copy.renewalUpcoming.subject(plan, when)}`,
        paragraphs: [copy.renewalUpcoming.body(plan, when, formatMoney(amount)), copy.renewalUpcoming.nothing, copy.renewalUpcoming.cancel, ...(context.billingIsTest ? [copy.testNote] : [])],
        action: { label: copy.renewalUpcoming.action, path: `${base}/plano` },
      }, kind, context);
    }
    default:
      return null;
  }
}
