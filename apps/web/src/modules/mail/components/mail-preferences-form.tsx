"use client";

import { useActionState } from "react";
import { MAIL_PREFERENCES_COPY as MAIL_PREFERENCES_COPY_BY_LOCALE } from "@/content/localized";
import { useCopy } from "@/ui/locale-context";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import { Button } from "@/ui";
import { FormStatus } from "@/ui/form-status";
import { setNewLeadNoticesAction } from "../preferences";

/** The new-contact notice switch on "Meus dados". A plain checkbox and a button: works without JavaScript. */
export function MailPreferencesForm({ newLeads }: { newLeads: boolean }) {
  const MAIL_PREFERENCES_COPY = useCopy(MAIL_PREFERENCES_COPY_BY_LOCALE);
  const [state, formAction, pending] = useActionState(setNewLeadNoticesAction, IDLE_FORM_STATE);
  const copy = MAIL_PREFERENCES_COPY;
  return (
    <form action={formAction} className="mt-4 grid gap-3">
      <div className="flex items-start gap-3">
        <input id="notice-new-leads" name="newLeads" type="checkbox" defaultChecked={newLeads} className="mt-0.5 size-6 flex-none accent-[var(--app-accent)]" aria-describedby="notice-new-leads-hint" />
        <div className="grid gap-1">
          <label htmlFor="notice-new-leads" className="font-semibold">{copy.newLeads}</label>
          <p id="notice-new-leads-hint" className="m-0 text-sm text-app-muted">{copy.newLeadsHint}</p>
        </div>
      </div>
      <div><Button type="submit" variant="secondary" loading={pending}>{copy.save}</Button></div>
      <FormStatus state={state} />
    </form>
  );
}
