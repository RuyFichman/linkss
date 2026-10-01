"use client";

import { useActionState, useState } from "react";
import { LEADS_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, Dialog, DialogActions, FormStatus } from "@/ui";

type DeleteAction = (previous: FormState) => Promise<FormState>;

/** Deleting a lead cannot be undone, so it asks first (UX-026: confirm only irreversible losses). */
export function DeleteLeadDialog({ action, name }: { action: DeleteAction; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  return (
    <>
      <Button type="button" variant="secondary" aria-label={LEADS_COPY.deleteLabel(name)} onClick={() => setOpen(true)}>{LEADS_COPY.delete}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={LEADS_COPY.deleteTitle}>
        <form action={formAction} className="grid gap-4">
          <p className="m-0"><b>{name}</b></p>
          <p className="m-0 text-app-muted">{LEADS_COPY.deleteWarning}</p>
          {state.status === "error" ? <FormStatus state={state} /> : null}
          <DialogActions>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{LEADS_COPY.cancel}</Button>
            <Button type="submit" variant="danger" loading={pending}>{LEADS_COPY.deleteConfirm}</Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
