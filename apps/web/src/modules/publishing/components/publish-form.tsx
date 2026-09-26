"use client";

import { useActionState } from "react";
import { PUBLISHING_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus } from "@/ui";

type PublishAction = (previous: FormState, formData: FormData) => Promise<FormState>;

/**
 * Sends the draft revision the person is looking at; the database refuses to publish if the draft
 * changed meanwhile (another tab or collaborator), so what goes live is what was reviewed.
 */
export function PublishForm({ action, draftRevision, upToDate, hasPublished }: { action: PublishAction; draftRevision: number; upToDate: boolean; hasPublished: boolean }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const label = upToDate ? PUBLISHING_COPY.upToDate : hasPublished ? PUBLISHING_COPY.publishChanges : PUBLISHING_COPY.publish;
  return (
    <form action={formAction} className="grid gap-3" aria-describedby="publish-status">
      <input type="hidden" name="expectedRevision" value={draftRevision} />
      <Button type="submit" loading={pending} disabled={upToDate} className="w-full sm:w-fit">{label}</Button>
      <FormStatus id="publish-status" state={state} />
    </form>
  );
}
