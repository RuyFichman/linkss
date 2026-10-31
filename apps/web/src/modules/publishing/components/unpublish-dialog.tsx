"use client";

import { useActionState, useState } from "react";
import { PUBLISHING_COPY as PUBLISHING_COPY_BY_LOCALE } from "@/content/localized";
import { useCopy } from "@/ui/locale-context";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, Dialog, DialogActions, FormStatus } from "@/ui";

type UnpublishAction = (previous: FormState) => Promise<FormState>;

export function UnpublishDialog({ action }: { action: UnpublishAction }) {
  const PUBLISHING_COPY = useCopy(PUBLISHING_COPY_BY_LOCALE);
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const copy = PUBLISHING_COPY.unpublish;
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>{copy.open}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={copy.title}>
        <form action={formAction} className="grid gap-4">
          <p className="m-0 text-app-muted">{copy.warning}</p>
          <FormStatus state={state} />
          <DialogActions>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{state.status === "success" ? "Fechar" : copy.cancel}</Button>
            {state.status === "success" ? null : <Button type="submit" variant="danger" loading={pending}>{copy.confirm}</Button>}
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
