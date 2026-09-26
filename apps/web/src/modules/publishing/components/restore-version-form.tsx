"use client";

import { useActionState } from "react";
import { PUBLISHING_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus } from "@/ui";

type RestoreAction = (previous: FormState) => Promise<FormState>;

export function RestoreVersionForm({ action, version }: { action: RestoreAction; version: number }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="grid justify-items-end gap-2">
      <Button type="submit" variant="secondary" loading={pending} aria-label={PUBLISHING_COPY.restoreLabel(version)}>{PUBLISHING_COPY.restore}</Button>
      {state.status === "error" ? <FormStatus state={state} /> : null}
    </form>
  );
}
