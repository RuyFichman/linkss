"use client";

import { useActionState, useRef } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import { TITLE_MAX_LENGTH } from "../content";
import type { ProfileField } from "../service";
import { SlugField } from "./slug-field";

type DuplicateAction = (previous: FormState, formData: FormData) => Promise<FormState<ProfileField>>;

/** Name and address of the copy, prefilled with suggestions the person can change. */
export function DuplicateProfileForm({ action, workspaceId, suggestedTitle, suggestedSlug }: { action: DuplicateAction; workspaceId: string; suggestedTitle: string; suggestedSlug: string }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  return (
    <form ref={formRef} action={formAction} className="grid gap-6" noValidate aria-describedby="duplicate-profile-status">
      <TextField id="duplicate-title" name="title" label={APP_COPY.duplicate.titleLabel} hint={APP_COPY.profileForm.titleHint} defaultValue={state.values?.title ?? suggestedTitle} maxLength={TITLE_MAX_LENGTH} required error={state.fieldErrors?.title} />
      <SlugField id="duplicate-slug" workspaceId={workspaceId} defaultValue={state.values?.slug ?? suggestedSlug} error={state.fieldErrors?.slug} />
      <FormStatus id="duplicate-profile-status" state={state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? { status: "idle" } : state} />
      <Button type="submit" loading={pending} className="w-full sm:w-fit">{APP_COPY.duplicate.submit}</Button>
    </form>
  );
}
