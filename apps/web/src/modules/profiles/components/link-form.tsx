"use client";

import { useActionState, useEffect, useRef } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import { LINK_TITLE_MAX_LENGTH, LINK_URL_MAX_LENGTH } from "../draft-content";
import type { ProfileField } from "../service";

type LinkAction = (previous: FormState, formData: FormData) => Promise<FormState<ProfileField>>;

interface LinkFormProps {
  action: LinkAction;
  idPrefix: string;
  initial?: { title: string; url: string };
  submitLabel: string;
  onDone?: () => void;
}

/** Add form (no `initial`) or edit form for one link. The add form clears itself after success. */
export function LinkForm({ action, idPrefix, initial, submitLabel, onDone }: LinkFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);

  useEffect(() => {
    if (state.status !== "success") return;
    if (!initial) formRef.current?.reset();
    onDone?.();
  }, [state, initial, onDone]);

  const values = state.status === "error" ? state.values : undefined;
  return (
    <form ref={formRef} action={formAction} className="grid gap-4" noValidate aria-describedby={`${idPrefix}-status`}>
      <TextField id={`${idPrefix}-title`} name="title" label={APP_COPY.links.titleLabel} hint={APP_COPY.links.titleHint} defaultValue={values?.title ?? initial?.title} maxLength={LINK_TITLE_MAX_LENGTH} required error={state.fieldErrors?.title} />
      <TextField id={`${idPrefix}-url`} name="url" label={APP_COPY.links.urlLabel} hint={APP_COPY.links.urlHint} defaultValue={values?.url ?? initial?.url} maxLength={LINK_URL_MAX_LENGTH} inputMode="url" autoComplete="url" required error={state.fieldErrors?.url} />
      <FormStatus id={`${idPrefix}-status`} state={state} />
      <Button type="submit" loading={pending} className="w-full sm:w-fit">{submitLabel}</Button>
    </form>
  );
}
