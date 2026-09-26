"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { AUTH_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import { Button, FormStatus, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import { signInAction } from "../actions";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);

  return (
    <form ref={formRef} action={action} className="grid gap-5" noValidate aria-describedby="signin-status">
      <input type="hidden" name="next" value={next} />
      <TextField id="signin-email" name="email" type="email" label={AUTH_COPY.fields.email} autoComplete="email" inputMode="email" required defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <TextField id="signin-password" name="password" type="password" label={AUTH_COPY.fields.password} autoComplete="current-password" required error={state.fieldErrors?.password} />
      <FormStatus id="signin-status" state={state} />
      {state.code === "email-not-confirmed" ? <Link className="font-bold text-app-accent underline" href="/confirmar-email">{AUTH_COPY.confirmEmail.submit}</Link> : null}
      <Button type="submit" loading={pending}>{AUTH_COPY.signIn.submit}</Button>
      <div className="flex flex-wrap justify-between gap-3">
        <Link className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href="/recuperar-acesso">{AUTH_COPY.signIn.forgot}</Link>
        <p className="m-0 inline-flex min-h-11 items-center gap-1 text-app-muted">{AUTH_COPY.signIn.noAccount} <Link className="font-bold text-app-accent underline" href="/cadastro">{AUTH_COPY.signIn.signUpLink}</Link></p>
      </div>
    </form>
  );
}
