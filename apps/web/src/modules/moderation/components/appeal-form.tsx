"use client";

import { useActionState, useRef } from "react";
import { MODERATION_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus, TextAreaField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import { APPEAL_MAX_LENGTH, APPEAL_MIN_LENGTH } from "../appeals";

type AppealAction = (previous: FormState, formData: FormData) => Promise<FormState<"message">>;

/** The appeal an owner or admin sends against a suspension. The server and the database decide. */
export function AppealForm({ action }: { action: AppealAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const copy = MODERATION_COPY.appeal;

  return (
    <form ref={formRef} action={formAction} className="grid gap-4" noValidate aria-describedby="appeal-status">
      <TextAreaField id="appeal-message" name="message" label={copy.label} hint={copy.hint} rows={6} required minLength={APPEAL_MIN_LENGTH} maxLength={APPEAL_MAX_LENGTH} defaultValue={state.values?.message} error={state.fieldErrors?.message} />
      <FormStatus id="appeal-status" state={state} />
      <div><Button type="submit" loading={pending}>{copy.submit}</Button></div>
    </form>
  );
}
