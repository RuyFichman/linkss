"use client";

import { useActionState, useRef, useState } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus, TextAreaField, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import { BIO_MAX_LENGTH, TITLE_MAX_LENGTH } from "../content";
import type { ProfileField } from "../service";
import { ProfileAvatar } from "./profile-avatar";
import { SlugField } from "./slug-field";

type ProfileAction = (previous: FormState, formData: FormData) => Promise<FormState<ProfileField>>;

export function CreateProfileForm({ action, workspaceId, submitLabel = APP_COPY.onboarding.submit }: { action: ProfileAction; workspaceId: string; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const [title, setTitle] = useState(state.values?.title ?? "");
  const [bio, setBio] = useState(state.values?.bio ?? "");

  return (
    <form ref={formRef} action={formAction} className="grid gap-6" noValidate aria-describedby="create-profile-status">
      <TextField id="profile-title" name="title" label={APP_COPY.profileForm.title} hint={APP_COPY.profileForm.titleHint} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={TITLE_MAX_LENGTH} required error={state.fieldErrors?.title} />
      <SlugField id="profile-slug" workspaceId={workspaceId} suggestFrom={title} defaultValue={state.values?.slug} error={state.fieldErrors?.slug} />
      <TextAreaField id="profile-bio" name="bio" label={APP_COPY.profileForm.bio} hint={APP_COPY.profileForm.bioHint(Math.max(0, BIO_MAX_LENGTH - bio.length))} value={bio} onChange={(event) => setBio(event.target.value)} maxLength={BIO_MAX_LENGTH} rows={3} error={state.fieldErrors?.bio} />
      <fieldset className="grid gap-2 rounded-2xl border border-app-border p-4">
        <legend className="ui-label px-1">{APP_COPY.profileForm.avatar}</legend>
        <div className="flex items-center gap-4">
          <ProfileAvatar title={title || "?"} />
          <p className="m-0 text-sm text-app-muted">{APP_COPY.profileForm.avatarPlaceholder}</p>
        </div>
      </fieldset>
      <FormStatus id="create-profile-status" state={state} />
      <Button type="submit" loading={pending} className="w-full sm:w-fit">{submitLabel}</Button>
    </form>
  );
}
