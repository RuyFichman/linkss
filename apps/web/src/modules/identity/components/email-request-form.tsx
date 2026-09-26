"use client";

import { useActionState, useRef } from "react";
import { AUTH_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import { requestRecoveryAction, resendConfirmationAction } from "../actions";

type EmailAction = (previous: FormState, formData: FormData) => Promise<FormState<"email">>;
const ACTIONS: Record<"recovery" | "confirmation", EmailAction> = { recovery: requestRecoveryAction, confirmation: resendConfirmationAction };

/** Single-email forms with neutral answers: password recovery and confirmation resend. */
export function EmailRequestForm({ purpose, submitLabel }: { purpose: "recovery" | "confirmation"; submitLabel: string }) {
  const [state, action, pending] = useActionState(ACTIONS[purpose], IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const id = `${purpose}-email`;

  return (
    <form ref={formRef} action={action} className="grid gap-5" noValidate aria-describedby={`${purpose}-status`}>
      <TextField id={id} name="email" type="email" label={AUTH_COPY.fields.email} autoComplete="email" inputMode="email" required defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <FormStatus id={`${purpose}-status`} state={state} />
      <Button type="submit" loading={pending}>{submitLabel}</Button>
    </form>
  );
}
