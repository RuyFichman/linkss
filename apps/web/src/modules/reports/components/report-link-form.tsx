"use client";

import { useActionState, useRef, useState } from "react";
import { REPORTS_COPY } from "@/content/pt-BR";
import { formatDateTime } from "@/lib/format-date";
import { Button, FormStatus, SelectField, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import type { ReportLinkFormState } from "../actions";
import { DEFAULT_REPORT_EXPIRY, DEFAULT_REPORT_PERIOD, REPORT_EXPIRY_OPTIONS, REPORT_LABEL_MAX_LENGTH, type ReportPeriod } from "../links";

type CreateAction = (previous: ReportLinkFormState, formData: FormData) => Promise<ReportLinkFormState>;

const IDLE: ReportLinkFormState = { status: "idle" };

/**
 * Creates a report link and shows it once, to be copied and sent by its creator. The address is
 * not kept anywhere after this screen (only a hash is stored): a lost link means a new one.
 */
export function ReportLinkForm({ action, periods }: { action: CreateAction; periods: readonly ReportPeriod[] }) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const [copyStatus, setCopyStatus] = useState<{ url: string; text: string } | null>(null);
  useFocusFirstError(formRef, state);
  const copy = REPORTS_COPY.form;
  const link = state.link;
  const defaultPeriod = periods.includes(DEFAULT_REPORT_PERIOD) ? DEFAULT_REPORT_PERIOD : periods[periods.length - 1];

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus({ url, text: copy.copied });
    } catch {
      linkRef.current?.select();
      setCopyStatus({ url, text: copy.copyFailed });
    }
  }

  return (
    <div className="grid gap-5">
      <form ref={formRef} action={formAction} className="grid gap-5" noValidate aria-describedby="report-link-status">
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField id="report-period" name="period" label={copy.period} hint={copy.periodHint} defaultValue={state.values?.period ?? String(defaultPeriod)} error={state.fieldErrors?.period}>
            {periods.map((days) => <option key={days} value={days}>{copy.periodOption(days)}</option>)}
          </SelectField>
          <SelectField id="report-expires" name="expires" label={copy.expires} hint={copy.expiresHint} defaultValue={state.values?.expires ?? String(DEFAULT_REPORT_EXPIRY)} error={state.fieldErrors?.expires}>
            {REPORT_EXPIRY_OPTIONS.map((days) => <option key={days} value={days}>{copy.expiresOption(days)}</option>)}
          </SelectField>
        </div>
        <TextField id="report-label" name="label" label={copy.label} hint={copy.labelHint} autoComplete="off" maxLength={REPORT_LABEL_MAX_LENGTH} defaultValue={state.status === "error" ? state.values?.label : ""} error={state.fieldErrors?.label} />
        <FormStatus id="report-link-status" state={state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? { status: "idle" } : state} />
        <Button type="submit" loading={pending} className="w-full sm:w-fit">{copy.submit}</Button>
      </form>

      {link ? (
        <section className="grid gap-3 rounded-2xl border border-app-border bg-app-surface-soft p-4" aria-label={copy.linkLabel}>
          <div className="ui-field">
            <label htmlFor="report-link-url">{copy.linkLabel}</label>
            <input ref={linkRef} id="report-link-url" className="ui-input" value={link.url} readOnly onFocus={(event) => event.currentTarget.select()} aria-describedby="report-link-hint" />
            <p className="ui-hint" id="report-link-hint">{copy.linkHint(formatDateTime(link.expiresAt))}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => void copyLink(link.url)}>{copy.copy}</Button>
            <span role="status" aria-live="polite" className="text-sm font-bold">{copyStatus?.url === link.url ? copyStatus.text : ""}</span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
