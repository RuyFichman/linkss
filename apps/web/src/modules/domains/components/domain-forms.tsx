"use client";

import { useActionState, useRef, useState } from "react";
import { DOMAINS_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import type { DomainFormState } from "../actions";
import type { DnsRecord } from "../adapter";
import { HOSTNAME_MAX_LENGTH } from "../hostname";

const IDLE: DomainFormState = { status: "idle" };

/** Claims a hostname for the page. The answer is the next step on the same screen, never a domain in force. */
export function DomainClaimForm({ action }: { action: (previous: DomainFormState, formData: FormData) => Promise<DomainFormState> }) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const copy = DOMAINS_COPY.claim;
  return (
    <form ref={formRef} action={formAction} className="grid gap-4" noValidate aria-describedby="domain-claim-status">
      <TextField
        id="domain-hostname" name="hostname" label={copy.hostname} hint={copy.hostnameHint} inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
        maxLength={HOSTNAME_MAX_LENGTH + 16} defaultValue={state.values?.hostname ?? ""} error={state.fieldErrors?.hostname}
      />
      <FormStatus id="domain-claim-status" state={state.fieldErrors?.hostname ? { status: "idle" } : state} />
      <Button type="submit" loading={pending} className="w-full sm:w-fit">{copy.submit}</Button>
    </form>
  );
}

/** Runs the DNS check on the server and says what it found. Safe to repeat. */
export function DomainVerifyForm({ action, label }: { action: (previous: FormState) => Promise<FormState>; label: string }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="grid gap-3" aria-describedby="domain-verify-status">
      <FormStatus id="domain-verify-status" state={state} />
      <Button type="submit" loading={pending} className="w-full sm:w-fit">{label}</Button>
    </form>
  );
}

/** One DNS record to create, as selectable text with copy buttons for the two values people paste. */
export function DnsRecordCard({ record }: { record: DnsRecord }) {
  const copy = DOMAINS_COPY.records;
  const [status, setStatus] = useState("");

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(copy.copied);
    } catch {
      setStatus(copy.copyFailed);
    }
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-app-border bg-app-surface-soft p-4">
      <dl className="m-0 grid gap-3" aria-label={copy.caption}>
        <div className="grid gap-1">
          <dt className="text-sm text-app-muted">{copy.type}</dt>
          <dd className="m-0 font-mono font-bold">{record.type}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-sm text-app-muted">{copy.name}</dt>
          <dd className="m-0 font-mono font-bold break-all select-all">{record.name}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-sm text-app-muted">{copy.value}</dt>
          <dd className="m-0 font-mono font-bold break-all select-all">{record.value}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => void copyText(record.name)}>{copy.copy(copy.nameWord)}</Button>
        <Button type="button" variant="secondary" onClick={() => void copyText(record.value)}>{copy.copy(copy.valueWord)}</Button>
        <span role="status" aria-live="polite" className="text-sm font-bold">{status}</span>
      </div>
    </div>
  );
}
