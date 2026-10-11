/**
 * Suspension notice and appeal (ADR 0019): what a workspace is told about a page suspended by
 * moderation, and the appeal an owner or admin may send. The database decides everything
 * (`get_page_moderation`, `submit_moderation_appeal`); this module reads the answers and mirrors
 * the message rules so the form can explain a refusal before the round trip.
 */
export const SUSPENSION_CATEGORIES = ["phishing", "impersonation", "illegal", "spam", "privacy", "other"] as const;
export type SuspensionCategory = (typeof SUSPENSION_CATEGORIES)[number];

export type AppealStatus = "open" | "accepted" | "denied";

export interface PageAppeal {
  status: AppealStatus;
  createdAt: string;
  decidedAt: string | null;
  /** Written by the platform administrator for the workspace. */
  response: string | null;
  /** The appeal text; `null` for a member who cannot appeal. */
  message: string | null;
}

export interface PageModeration {
  status: "active" | "suspended";
  title: string;
  slug: string;
  category: SuspensionCategory | null;
  suspendedAt: string | null;
  canAppeal: boolean;
  appealsLeft: number;
  appeals: PageAppeal[];
}

export const APPEAL_MIN_LENGTH = 20;
export const APPEAL_MAX_LENGTH = 1000;
// Same set the database refuses: control characters other than tab, line feed and carriage return.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

export type AppealMessageProblem = "too_short" | "too_long" | "invalid";

/** The trimmed message, or what is wrong with it. */
export function parseAppealMessage(value: unknown): { ok: true; message: string } | { ok: false; problem: AppealMessageProblem } {
  if (typeof value !== "string") return { ok: false, problem: "invalid" };
  const message = value.trim();
  if (CONTROL.test(message)) return { ok: false, problem: "invalid" };
  if (message.length < APPEAL_MIN_LENGTH) return { ok: false, problem: "too_short" };
  if (message.length > APPEAL_MAX_LENGTH) return { ok: false, problem: "too_long" };
  return { ok: true, message };
}

export type AppealOutcome = "sent" | "invalid" | "forbidden" | "not_found" | "not_suspended" | "already_open" | "limit_reached" | "not_deployed" | "unavailable";

/** Postgres error code of a refused appeal -> the outcome shown to the person. */
export function appealOutcome(code: string | null | undefined, missingSchema: boolean): Exclude<AppealOutcome, "sent"> {
  if (missingSchema) return "not_deployed";
  switch (code) {
    case "22023": return "invalid";
    case "42501": return "forbidden";
    case "P0002": return "not_found";
    case "LK126": return "not_suspended";
    case "LK127": return "already_open";
    case "LK128": return "limit_reached";
    default: return "unavailable";
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isCategory(value: unknown): value is SuspensionCategory {
  return SUSPENSION_CATEGORIES.includes(value as SuspensionCategory);
}

function parseAppeal(value: unknown): PageAppeal | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const status = row.status;
  const createdAt = text(row.createdAt);
  if ((status !== "open" && status !== "accepted" && status !== "denied") || !createdAt) return null;
  return { status, createdAt, decidedAt: text(row.decidedAt), response: text(row.response), message: text(row.message) };
}

/** Reads the answer of `get_page_moderation`; anything malformed is `null` (treated as unavailable). */
export function parsePageModeration(data: unknown): PageModeration | null {
  if (typeof data !== "object" || data === null) return null;
  const row = data as Record<string, unknown>;
  const title = text(row.title);
  const slug = text(row.slug);
  if ((row.status !== "active" && row.status !== "suspended") || title === null || slug === null) return null;
  return {
    status: row.status,
    title,
    slug,
    category: isCategory(row.category) ? row.category : null,
    suspendedAt: text(row.suspendedAt),
    canAppeal: row.canAppeal === true,
    appealsLeft: typeof row.appealsLeft === "number" && row.appealsLeft > 0 ? Math.floor(row.appealsLeft) : 0,
    appeals: Array.isArray(row.appeals) ? row.appeals.map(parseAppeal).filter((appeal): appeal is PageAppeal => appeal !== null) : [],
  };
}

/** Whether the form is offered: suspended, allowed to appeal, none waiting and some left. */
export function canSendAppeal(moderation: PageModeration): boolean {
  return moderation.status === "suspended" && moderation.canAppeal && moderation.appealsLeft > 0 && !moderation.appeals.some((appeal) => appeal.status === "open");
}
