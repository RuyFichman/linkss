"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
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

type Opened = Pick<ConfirmDialogProps, "action" | "title" | "children" | "confirmLabel" | "confirmVariant" | "cancelLabel">;

/**
 * A simple confirmation for one command: says what happens, runs the action, shows its result.
 * Focus returns to the opening button when the dialog closes (ui/dialog).
 *
 * Each opening keeps the props it was opened with and starts from a fresh result. A command can
 * change the very control that opened it (archiving turns "Arquivar" into "Desarquivar" once the
 * server re-renders the list): the open dialog keeps its own title and message, and the next
 * opening confirms the new command instead of showing the previous one's result.
 */
export function ConfirmDialog({ action, openLabel, openAriaLabel, openVariant = "secondary", title, children, confirmLabel, confirmVariant = "primary", cancelLabel }: ConfirmDialogProps) {
  const [opened, setOpened] = useState<{ id: number; props: Opened } | null>(null);
  const openings = useRef(0);
  function open() {
    openings.current += 1;
    setOpened({ id: openings.current, props: { action, title, children, confirmLabel, confirmVariant, cancelLabel } });
  }
  const close = () => setOpened(null);
  return (
    <>
      <Button type="button" variant={openVariant} aria-label={openAriaLabel} onClick={open}>{openLabel}</Button>
      <Dialog open={opened !== null} onClose={close} title={opened?.props.title ?? title}>
        {opened ? <ConfirmForm key={opened.id} {...opened.props} onClose={close} /> : null}
      </Dialog>
    </>
  );
}

function ConfirmForm({ action, children, confirmLabel, confirmVariant = "primary", cancelLabel, onClose }: Opened & { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const done = state.status === "success";
  return (
    <form action={formAction} className="grid gap-4">
      {done ? null : children}
      <FormStatus state={state} />
      <DialogActions>
        <Button type="button" variant="secondary" onClick={onClose}>{done ? "Fechar" : cancelLabel}</Button>
        {done ? null : <Button type="submit" variant={confirmVariant} loading={pending}>{confirmLabel}</Button>}
      </DialogActions>
    </form>
  );
}
