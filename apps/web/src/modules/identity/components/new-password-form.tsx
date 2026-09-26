"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import { AUTH_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import { Button, FormStatus, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import { updatePasswordAction } from "../actions";

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);

  return (
    <form ref={formRef} action={action} className="grid gap-5" noValidate aria-describedby="new-password-status">
      <TextField id="new-password" name="password" type="password" label={AUTH_COPY.fields.newPassword} autoComplete="new-password" required minLength={8} maxLength={72} hint={AUTH_COPY.passwordHint} error={state.fieldErrors?.password} />
      <TextField id="new-password-confirmation" name="confirmation" type="password" label={AUTH_COPY.fields.confirmation} autoComplete="new-password" required error={state.fieldErrors?.confirmation} />
      <FormStatus id="new-password-status" state={state} />
      {state.code === "session-expired" ? <Link className="font-bold text-app-accent underline" href="/recuperar-acesso">{AUTH_COPY.link.requestNewRecovery}</Link> : null}
      <Button type="submit" loading={pending}>{AUTH_COPY.resetPassword.submit}</Button>
    </form>
  );
}
