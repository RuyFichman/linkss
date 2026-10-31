"use client";

import Link from "next/link";
import { useActionState } from "react";
import { BILLING_COPY as BILLING_COPY_BY_LOCALE } from "@/content/localized";
import { useCopy } from "@/ui/locale-context";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button } from "@/ui";
import { FormStatus } from "@/ui/form-status";
import { CANCELLATION_COMMENT_MAX_LENGTH, CANCELLATION_REASONS } from "../cancellation";

/**
 * The last step of a cancellation: an optional reason, an optional comment and the button. Nothing
 * here is required and nothing here can stop the cancellation: the action cancels first and only
 * then stores what was answered. It re-authorizes on the server and in the database.
 */
export function CancelSubscriptionForm({ action, backHref }: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  backHref: string;
}) {
  const BILLING_COPY = useCopy(BILLING_COPY_BY_LOCALE);
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const copy = BILLING_COPY;
  return (
    <form action={formAction} className="grid gap-5">
      <div className="surface-card grid gap-4 p-5 sm:p-6">
        {/* The question is the label of the choice: one name for one control. */}
        <div className="grid gap-2">
          <label htmlFor="cancel-reason" className="text-xl font-bold">{copy.cancelReason.label}</label>
          <p id="cancel-reason-hint" className="m-0 text-sm text-app-muted">{copy.cancelReason.hint}</p>
          <select id="cancel-reason" name="reason" className="ui-select" defaultValue="" aria-describedby="cancel-reason-hint">
            <option value="">{copy.cancelReason.none}</option>
            {CANCELLATION_REASONS.map((reason) => <option key={reason} value={reason}>{copy.cancelReason.options[reason]}</option>)}
          </select>
        </div>
        <div className="ui-field">
          <label htmlFor="cancel-comment">{copy.cancelReason.commentLabel}</label>
          <textarea id="cancel-comment" name="comment" className="ui-textarea" maxLength={CANCELLATION_COMMENT_MAX_LENGTH} rows={3} aria-describedby="cancel-comment-hint" />
          <p id="cancel-comment-hint" className="m-0 text-sm text-app-muted">{copy.cancelReason.commentHint(CANCELLATION_COMMENT_MAX_LENGTH)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <Button type="submit" variant="danger" loading={pending} className="w-full sm:w-auto">{copy.confirm.confirmCancel}</Button>
        <Link className="ui-button ui-button-secondary" href={backHref}>{copy.actions.back}</Link>
      </div>
      <FormStatus state={state} />
    </form>
  );
}
