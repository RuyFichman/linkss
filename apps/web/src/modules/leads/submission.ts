import { FORM_FIELD_RULES, FORM_FIELDS, type FormField } from "@/modules/blocks/form";

/**
 * Validation and normalization of one form submission (ADR 0010). Mirror of the checks inside
 * public.submit_form_lead(): the application runs them first to answer with field-level messages,
 * the database runs them again against the published form and is the authority.
 */
export interface FormDefinition {
  fields: readonly FormField[];
  consentRequired: boolean;
}

export interface RawSubmission {
  values: Partial<Record<FormField, unknown>>;
  consent: boolean;
  /** Hidden field real visitors never see. Anything in it marks the submission as automated. */
  honeypot: unknown;
}

export type LeadFieldProblem = "required" | "invalid" | "too_long";
export type LeadFieldProblems = Partial<Record<FormField, LeadFieldProblem>>;
export type LeadValues = Partial<Record<FormField, string>>;

export type SubmissionCheck =
  | { ok: true; values: LeadValues; consent: boolean }
  | { ok: false; reason: "honeypot" }
  | { ok: false; reason: "invalid"; problems: LeadFieldProblems }
  | { ok: false; reason: "consent_required" };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_ALLOWED = /^\+?[\d\s().-]+$/;
// Line breaks are allowed in the message only; every other control character is refused.
const CONTROL_SINGLE_LINE = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_MULTI_LINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
export const LEAD_PHONE_MIN_DIGITS = 8;
export const LEAD_PHONE_MAX_DIGITS = 15;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Stored form of one field, or the reason it is refused. An absent optional field is "". */
export function normalizeLeadField(field: FormField, raw: unknown): { ok: true; value: string } | { ok: false; problem: LeadFieldProblem } {
  const rule = FORM_FIELD_RULES[field];
  const value = field === "message" ? text(raw).replace(/\r\n?/g, "\n").trim() : text(raw).trim().replace(/\s+/g, " ");
  if (value === "") return rule.required ? { ok: false, problem: "required" } : { ok: true, value: "" };
  if (Array.from(value).length > rule.maxLength) return { ok: false, problem: "too_long" };
  if ((field === "message" ? CONTROL_MULTI_LINE : CONTROL_SINGLE_LINE).test(value)) return { ok: false, problem: "invalid" };
  if (field === "email") {
    const email = value.toLowerCase();
    return EMAIL_PATTERN.test(email) ? { ok: true, value: email } : { ok: false, problem: "invalid" };
  }
  if (field === "phone") {
    if (!PHONE_ALLOWED.test(value)) return { ok: false, problem: "invalid" };
    const digits = value.replace(/\D/g, "");
    if (digits.length < LEAD_PHONE_MIN_DIGITS || digits.length > LEAD_PHONE_MAX_DIGITS) return { ok: false, problem: "invalid" };
    return { ok: true, value: `${value.startsWith("+") ? "+" : ""}${digits}` };
  }
  return { ok: true, value };
}

/**
 * Checks a submission against the published form. Only the form's own fields are read; anything
 * else in the request is ignored. The honeypot is checked first so automated posts learn nothing.
 */
export function validateSubmission(definition: FormDefinition, submission: RawSubmission): SubmissionCheck {
  if (text(submission.honeypot).trim() !== "") return { ok: false, reason: "honeypot" };
  const values: LeadValues = {};
  const problems: LeadFieldProblems = {};
  for (const field of FORM_FIELDS) {
    if (!definition.fields.includes(field)) continue;
    const result = normalizeLeadField(field, submission.values[field]);
    if (result.ok) {
      if (result.value !== "") values[field] = result.value;
    } else {
      problems[field] = result.problem;
    }
  }
  if (Object.keys(problems).length > 0) return { ok: false, reason: "invalid", problems };
  if (definition.consentRequired && !submission.consent) return { ok: false, reason: "consent_required" };
  return { ok: true, values, consent: submission.consent };
}
