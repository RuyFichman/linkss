"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { PUBLIC_PAGE_COPY } from "@/content/public-page";
import { FORM_FIELD_RULES, type FormField } from "@/modules/blocks/form";
import type { LeadFormState } from "@/modules/leads/actions";

export type LeadFormAction = (state: LeadFormState, formData: FormData) => Promise<LeadFormState>;

interface LeadFormProps {
  blockId: string;
  title: string;
  fields: readonly FormField[];
  buttonLabel: string;
  consentText: string;
  consentRequired: boolean;
  buttonClassName: string;
}

const BOX_CLASS = "grid gap-4 rounded-[var(--page-radius)] border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4 text-left text-[var(--surface-text)]";
const INPUT_CLASS = "min-h-11 w-full rounded-lg border border-[var(--surface-border)] bg-[var(--page-bg)] px-3 py-2 text-[var(--page-text)]";
const INITIAL: LeadFormState = { status: "idle" };

const INPUT_PROPS: Record<Exclude<FormField, "message">, { type: string; autoComplete: string; inputMode?: "email" | "tel" }> = {
  name: { type: "text", autoComplete: "name" },
  email: { type: "email", autoComplete: "email", inputMode: "email" },
  phone: { type: "tel", autoComplete: "tel", inputMode: "tel" },
};

function Fields({ id, props, state, disabled }: { id: string; props: LeadFormProps; state: LeadFormState; disabled: boolean }) {
  return (
    <>
      {props.fields.map((field) => {
        const fieldId = `${id}-${field}`;
        const problem = state.problems?.[field];
        const error = problem ? PUBLIC_PAGE_COPY.form.problems[field][problem] : undefined;
        const shared = {
          id: fieldId, name: field, className: INPUT_CLASS, disabled, required: FORM_FIELD_RULES[field].required, maxLength: FORM_FIELD_RULES[field].maxLength,
          defaultValue: state.values?.[field] ?? "", "aria-invalid": Boolean(error), "aria-describedby": error ? `${fieldId}-error` : undefined,
        };
        return (
          <div key={field} className="grid gap-1">
            <label className="text-sm font-bold" htmlFor={fieldId}>{PUBLIC_PAGE_COPY.form.fields[field]}</label>
            {field === "message" ? <textarea {...shared} rows={3} /> : <input {...shared} {...INPUT_PROPS[field]} />}
            {error ? <p id={`${fieldId}-error`} className="m-0 text-sm font-bold">{error}</p> : null}
          </div>
        );
      })}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input className="h-5 w-5 shrink-0" type="checkbox" name="consent" value="yes" disabled={disabled} required={props.consentRequired} defaultChecked={state.consent === true} />
        <span className="break-words">{props.consentText}{props.consentRequired ? "" : PUBLIC_PAGE_COPY.form.consentOptional}</span>
      </label>
    </>
  );
}

/** Same look as the live form, without an action: the editor preview must never submit. */
export function LeadFormPreview(props: LeadFormProps) {
  const id = useId();
  return (
    <div data-block-id={props.blockId} data-block-type="form" className={BOX_CLASS}>
      <strong className="text-lg leading-snug break-words">{props.title}</strong>
      <Fields id={id} props={props} state={INITIAL} disabled />
      <span className={`${props.buttonClassName} opacity-70`}>{props.buttonLabel}</span>
      <p className="m-0 text-sm text-[var(--surface-muted)]">{PUBLIC_PAGE_COPY.form.previewNote}</p>
    </div>
  );
}

const FAILURE_COPY = {
  invalid: PUBLIC_PAGE_COPY.form.invalid,
  consent_required: PUBLIC_PAGE_COPY.form.consentRequired,
  rate_limited: PUBLIC_PAGE_COPY.form.rateLimited,
  unavailable: PUBLIC_PAGE_COPY.form.unavailable,
} as const;

/**
 * Form block on a public page (ADR 0010). A plain HTML form posting to a Server Action: it works
 * with scripts blocked (the page comes back with the result) and, with scripts, updates in place.
 * The result message takes focus so it is announced and scrolled into view either way. A failure
 * here never affects the rest of the page.
 */
export function LeadForm({ action, ...props }: LeadFormProps & { action: LeadFormAction }) {
  const id = useId();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const data = { "data-block-id": props.blockId, "data-block-type": "form" };
  const result = useRef<HTMLParagraphElement>(null);

  // With scripts, focus moves to the result when it arrives (without them, `autoFocus` in the
  // returned HTML does the same): the message is announced and scrolled into view.
  useEffect(() => {
    if (state.status !== "idle") result.current?.focus();
  }, [state]);

  if (state.status === "ok") {
    return (
      <div {...data} className={BOX_CLASS}>
        <strong className="text-lg leading-snug break-words">{props.title}</strong>
        {/* Focus moves to the result of the person's own action (announced, and scrolled into view). */}
        <p ref={result} role="status" tabIndex={-1} autoFocus className="m-0 font-bold">{PUBLIC_PAGE_COPY.form.success}</p>
      </div>
    );
  }

  return (
    <form {...data} action={formAction} className={BOX_CLASS} aria-labelledby={`${id}-title`}>
      <strong id={`${id}-title`} className="text-lg leading-snug break-words">{props.title}</strong>
      {state.status !== "idle" ? (
        <p ref={result} role="alert" tabIndex={-1} autoFocus className="m-0 rounded-lg border border-current p-3 font-bold">{FAILURE_COPY[state.status]}</p>
      ) : null}
      {/* Honeypot: off-screen, out of the tab order and hidden from assistive technology. */}
      <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor={`${id}-website`}>{PUBLIC_PAGE_COPY.form.honeypot}</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <Fields id={id} props={props} state={state} disabled={false} />
      <button type="submit" className={props.buttonClassName} disabled={pending} aria-busy={pending || undefined}>{pending ? PUBLIC_PAGE_COPY.form.sending : props.buttonLabel}</button>
    </form>
  );
}
