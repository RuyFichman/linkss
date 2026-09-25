"use client";

import { useActionState, useRef } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import { Button, FormStatus, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import { createAgencyWorkspaceAction } from "../workspace-actions";

export function CreateAgencyForm() {
  const [state, action, pending] = useActionState(createAgencyWorkspaceAction, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  return (
    <form ref={formRef} action={action} className="grid gap-5" noValidate aria-describedby="create-agency-status">
      <TextField id="agency-name" name="name" label={APP_COPY.workspace.agencyNameLabel} autoComplete="organization" maxLength={80} required defaultValue={state.values?.name} error={state.fieldErrors?.name} />
      <FormStatus id="create-agency-status" state={state.fieldErrors?.name ? { status: "idle" } : state} />
      <Button type="submit" loading={pending} className="w-full sm:w-fit">{APP_COPY.workspace.createAgency}</Button>
    </form>
  );
}
