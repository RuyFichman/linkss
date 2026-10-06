"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TEAM_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus } from "@/ui";

type AcceptAction = (previous: FormState) => Promise<FormState>;

/** One deliberate step: nothing is granted by opening the link. */
export function AcceptInvitationForm({ action }: { action: AcceptAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="grid gap-4">
      <FormStatus state={state} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={pending}>{TEAM_COPY.accept.valid.submit}</Button>
        <Link className="ui-button ui-button-secondary" href="/app">{TEAM_COPY.accept.valid.decline}</Link>
      </div>
    </form>
  );
}
