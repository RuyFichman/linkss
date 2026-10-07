"use client";

import { useActionState, useState, type ReactNode } from "react";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button } from "./button";
import { Dialog, DialogActions } from "./dialog";
import { FormStatus } from "./form-status";

type ConfirmAction = (previous: FormState) => Promise<FormState>;

interface ConfirmDialogProps {
  /** Server Action already bound to its target; it re-authorizes on the server. */
  action: ConfirmAction;
  /** Visible text of the button that opens the dialog. */
  openLabel: string;
  /** Accessible name when the visible text alone is ambiguous in a list (e.g. "Arquivar: Café Ipê"). */
  openAriaLabel?: string;
  openVariant?: "secondary" | "danger" | "ghost";
  title: string;
  /** What will happen, in words. */
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  cancelLabel: string;
}

/**
 * A simple confirmation for one command: says what happens, runs the action, shows its result.
 * Focus returns to the opening button when the dialog closes (ui/dialog).
 */
export function ConfirmDialog({ action, openLabel, openAriaLabel, openVariant = "secondary", title, children, confirmLabel, confirmVariant = "primary", cancelLabel }: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const done = state.status === "success";
  return (
    <>
      <Button type="button" variant={openVariant} aria-label={openAriaLabel} onClick={() => setOpen(true)}>{openLabel}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <form action={formAction} className="grid gap-4">
          {done ? null : children}
          <FormStatus state={state} />
          <DialogActions>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{done ? "Fechar" : cancelLabel}</Button>
            {done ? null : <Button type="submit" variant={confirmVariant} loading={pending}>{confirmLabel}</Button>}
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
