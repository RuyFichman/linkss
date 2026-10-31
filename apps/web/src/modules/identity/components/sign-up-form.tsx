"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { SIGN_UP_COPY } from "@/content/sign-up";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { Button, FormStatus, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import { signUpAction } from "../actions";
import { CaptchaField } from "./captcha-field";

/** `locale` is the language of the form and the one recorded for the new account (ADR 0022). */
export function SignUpForm({ next = "", locale = DEFAULT_LOCALE }: { next?: string; locale?: Locale }) {
  const [state, action, pending] = useActionState(signUpAction, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const copy = SIGN_UP_COPY[locale];

  if (state.status === "success") {
    return (
      <section className="grid gap-4" aria-labelledby="signup-done-title">
        <h2 id="signup-done-title" className="text-2xl font-bold">{copy.signUp.checkEmailTitle}</h2>
        <FormStatus state={state} />
        <p className="text-app-muted">{copy.signUp.resendPrompt} <Link className="font-bold text-app-accent underline" href="/confirmar-email">{copy.signUp.resendLink}</Link>.</p>
      </section>
    );
  }

  return (
    <form ref={formRef} action={action} className="grid gap-5" noValidate aria-describedby="signup-status">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="locale" value={locale} />
      <TextField id="signup-name" name="name" label={copy.fields.name} autoComplete="name" required defaultValue={state.values?.name} error={state.fieldErrors?.name} />
      <TextField id="signup-email" name="email" type="email" label={copy.fields.email} autoComplete="email" inputMode="email" required defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <TextField id="signup-password" name="password" type="password" label={copy.fields.password} autoComplete="new-password" required minLength={8} maxLength={72} hint={copy.passwordHint} error={state.fieldErrors?.password} />
      <CaptchaField resetSignal={state} label={copy.captcha.label} />
      <FormStatus id="signup-status" state={state} />
      <Button type="submit" loading={pending} loadingLabel={copy.signUp.submitting}>{copy.signUp.submit}</Button>
      <p className="m-0 text-app-muted">{copy.signUp.haveAccount} <Link className="font-bold text-app-accent underline" href={next ? `/entrar?next=${encodeURIComponent(next)}` : "/entrar"}>{copy.signUp.signInLink}</Link></p>
    </form>
  );
}
