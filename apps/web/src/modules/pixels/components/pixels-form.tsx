"use client";

import { useActionState, useRef } from "react";
import { PIXELS_COPY } from "@/content/pt-BR";
import { Button, FormStatus, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import type { PixelsFormState } from "../actions";

const IDLE: PixelsFormState = { status: "idle" };

/** Two identifiers, nothing else: there is no field that takes a script. Empty turns one off. */
export function PixelsForm({ action, initial }: { action: (previous: PixelsFormState, formData: FormData) => Promise<PixelsFormState>; initial: { meta: string; ga: string } }) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const copy = PIXELS_COPY.form;
  const hasFieldErrors = Boolean(state.fieldErrors && Object.keys(state.fieldErrors).length > 0);
  return (
    <form ref={formRef} action={formAction} className="grid gap-5" noValidate aria-describedby="pixels-status">
      <TextField id="pixels-meta" name="meta" label={copy.meta} hint={copy.metaHint} inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={24} defaultValue={state.values?.meta ?? initial.meta} error={state.fieldErrors?.meta} />
      <TextField id="pixels-ga" name="ga" label={copy.ga} hint={copy.gaHint} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} defaultValue={state.values?.ga ?? initial.ga} error={state.fieldErrors?.ga} />
      <p className="m-0 text-sm text-app-muted">{copy.clearHint}</p>
      <FormStatus id="pixels-status" state={hasFieldErrors ? { status: "idle" } : state} />
      <Button type="submit" loading={pending} className="w-full sm:w-fit">{copy.submit}</Button>
    </form>
  );
}
