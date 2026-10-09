"use client";

import { useActionState } from "react";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button } from "@/ui";
import { FormStatus } from "@/ui/form-status";

/**
 * One billing command as a form: a button, its pending state and the answer in words. The action is
 * a Server Action already bound to its workspace; it re-authorizes on the server and in the
 * database, so this component decides nothing.
 */
export function BillingActionForm({ action, label, ariaLabel, variant = "primary", hideOnSuccess = false }: {
  action: (previous: FormState) => Promise<FormState>;
  label: string;
  ariaLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  /** After a change that cannot be repeated, the button gives way to the result. */
  hideOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="grid gap-2">
      {hideOnSuccess && state.status === "success" ? null : <Button type="submit" variant={variant} loading={pending} aria-label={ariaLabel} className="w-full sm:w-auto">{label}</Button>}
      <FormStatus state={state} />
    </form>
  );
}
