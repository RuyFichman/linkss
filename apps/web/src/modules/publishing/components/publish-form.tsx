"use client";

import { useActionState } from "react";
import { PUBLISHING_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus } from "@/ui";

type PublishAction = (previous: FormState, formData: FormData) => Promise<FormState>;

interface PublishFormProps {
  action: PublishAction;
  draftRevision: number;
  upToDate: boolean;
  hasPublished: boolean;
  /** Why publishing is not possible right now (unsaved, failing or conflicting changes). */
  blockedReason?: string | null;
}

/**
 * Sends the draft revision the person is looking at; the database refuses to publish if the draft
 * changed meanwhile (another tab or collaborator), so what goes live is what was reviewed. In the
 * editor this is the last revision the server confirmed, and the button stays disabled until every
 * local change is saved.
 */
export function PublishForm({ action, draftRevision, upToDate, hasPublished, blockedReason = null }: PublishFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const label = upToDate ? PUBLISHING_COPY.upToDate : hasPublished ? PUBLISHING_COPY.publishChanges : PUBLISHING_COPY.publish;
  return (
    <form action={formAction} className="grid gap-2" aria-describedby="publish-status">
      <input type="hidden" name="expectedRevision" value={draftRevision} />
      <Button type="submit" loading={pending} disabled={upToDate || blockedReason !== null} aria-describedby={blockedReason ? "publish-blocked" : undefined} className="w-full sm:w-fit">{label}</Button>
      {blockedReason ? <p id="publish-blocked" className="m-0 text-sm text-app-muted">{blockedReason}</p> : null}
      <FormStatus id="publish-status" state={state} />
    </form>
  );
}
