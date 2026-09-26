"use client";

import { useActionState, useRef, useState } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus, TextAreaField, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import { BIO_MAX_LENGTH, TITLE_MAX_LENGTH } from "../content";
import type { ProfileField } from "../service";

type ProfileAction = (previous: FormState, formData: FormData) => Promise<FormState<ProfileField>>;

export function ProfileContentForm({ action, title, bio }: { action: ProfileAction; title: string; bio: string }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const [bioLength, setBioLength] = useState(bio.length);

  return (
    <form ref={formRef} action={formAction} className="grid gap-5" noValidate aria-describedby="profile-content-status">
      <TextField id="settings-title" name="title" label={APP_COPY.profileForm.title} defaultValue={state.values?.title ?? title} maxLength={TITLE_MAX_LENGTH} required error={state.fieldErrors?.title} />
      <TextAreaField id="settings-bio" name="bio" label={APP_COPY.profileForm.bio} hint={APP_COPY.profileForm.bioHint(Math.max(0, BIO_MAX_LENGTH - bioLength))} defaultValue={state.values?.bio ?? bio} onChange={(event) => setBioLength(event.target.value.length)} maxLength={BIO_MAX_LENGTH} rows={3} error={state.fieldErrors?.bio} />
      <FormStatus id="profile-content-status" state={state} />
      <Button type="submit" loading={pending} className="w-full sm:w-fit">{APP_COPY.profileForm.save}</Button>
    </form>
  );
}
