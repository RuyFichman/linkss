"use client";

import { useActionState, useRef, useState } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, Dialog, DialogActions, FormStatus, Notice } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import type { ProfileField } from "../service";
import { SlugField } from "./slug-field";

type ProfileAction = (previous: FormState, formData: FormData) => Promise<FormState<ProfileField>>;

interface ChangeSlugDialogProps {
  action: ProfileAction;
  currentSlug: string;
  workspaceId: string;
}

export function ChangeSlugDialog(props: ChangeSlugDialogProps) {
  const [open, setOpen] = useState(false);
  // A new key per opening gives each attempt a fresh action state.
  const [attempt, setAttempt] = useState(0);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => { setAttempt((value) => value + 1); setOpen(true); }}>{APP_COPY.slugChange.open}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={APP_COPY.slugChange.title}>
        {open ? <ChangeSlugForm key={attempt} {...props} onDone={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  );
}

function ChangeSlugForm({ action, currentSlug, workspaceId, onDone }: ChangeSlugDialogProps & { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);

  if (state.status === "success") {
    return (
      <div className="grid gap-4">
        <FormStatus state={state} />
        <DialogActions><Button type="button" onClick={onDone}>Concluir</Button></DialogActions>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="grid gap-5" noValidate>
      <Notice tone="warning">{APP_COPY.slugChange.warning}</Notice>
      <SlugField id="change-slug" workspaceId={workspaceId} currentSlug={currentSlug} defaultValue={state.values?.slug ?? currentSlug} error={state.fieldErrors?.slug} />
      {state.status === "error" && !state.fieldErrors?.slug ? <FormStatus state={state} /> : null}
      <DialogActions>
        <Button type="button" variant="secondary" onClick={onDone}>{APP_COPY.slugChange.cancel}</Button>
        <Button type="submit" loading={pending}>{APP_COPY.slugChange.confirm}</Button>
      </DialogActions>
    </form>
  );
}
