"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { AUTH_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import { Button, FormStatus, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import { signUpAction } from "../actions";

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);

  if (state.status === "success") {
    return (
      <section className="grid gap-4" aria-labelledby="signup-done-title">
        <h2 id="signup-done-title" className="text-2xl font-bold">{AUTH_COPY.signUp.checkEmailTitle}</h2>
        <FormStatus state={state} />
        <p className="text-app-muted">Não recebeu? <Link className="font-bold text-app-accent underline" href="/confirmar-email">Peça um novo link</Link>.</p>
      </section>
    );
  }

  return (
    <form ref={formRef} action={action} className="grid gap-5" noValidate aria-describedby="signup-status">
      <TextField id="signup-name" name="name" label={AUTH_COPY.fields.name} autoComplete="name" required defaultValue={state.values?.name} error={state.fieldErrors?.name} />
      <TextField id="signup-email" name="email" type="email" label={AUTH_COPY.fields.email} autoComplete="email" inputMode="email" required defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <TextField id="signup-password" name="password" type="password" label={AUTH_COPY.fields.password} autoComplete="new-password" required minLength={8} maxLength={72} hint={AUTH_COPY.passwordHint} error={state.fieldErrors?.password} />
      <FormStatus id="signup-status" state={state} />
      <Button type="submit" loading={pending}>{AUTH_COPY.signUp.submit}</Button>
      <p className="m-0 text-app-muted">{AUTH_COPY.signUp.haveAccount} <Link className="font-bold text-app-accent underline" href="/entrar">{AUTH_COPY.signUp.signInLink}</Link></p>
    </form>
  );
}
