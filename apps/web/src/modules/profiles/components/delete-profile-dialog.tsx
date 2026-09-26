"use client";

import { useActionState, useState } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, Dialog, DialogActions, FormStatus } from "@/ui";
import type { ProfileField } from "../service";

type DeleteAction = (previous: FormState) => Promise<FormState<ProfileField>>;

export function DeleteProfileDialog({ action, title }: { action: DeleteAction; title: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  return (
    <>
      <Button type="button" variant="danger" onClick={() => setOpen(true)}>{APP_COPY.deletePage.open}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={APP_COPY.deletePage.title}>
        <form action={formAction} className="grid gap-4">
          <p className="m-0"><b>{title}</b></p>
          <p className="m-0 text-app-muted">{APP_COPY.deletePage.warning}</p>
          <FormStatus state={state} />
          <DialogActions>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{APP_COPY.deletePage.cancel}</Button>
            <Button type="submit" variant="danger" loading={pending}>{APP_COPY.deletePage.confirm}</Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
