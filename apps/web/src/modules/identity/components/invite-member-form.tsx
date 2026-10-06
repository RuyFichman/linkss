"use client";

import { useActionState, useRef, useState } from "react";
import { APP_COPY, TEAM_COPY } from "@/content/pt-BR";
import { formatDateTime } from "@/lib/format-date";
import { Button, FormStatus, Notice, SelectField, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import type { InviteFormState } from "../member-actions";
import type { InvitableRole } from "../permissions";

type InviteAction = (previous: InviteFormState, formData: FormData) => Promise<InviteFormState>;

const IDLE: InviteFormState = { status: "idle" };

/**
 * Creates an invitation and shows its link once, to be copied and sent by the inviter (no e-mail is
 * sent). The link is not kept anywhere after this screen: a lost link means a new invitation.
 * When the invitation just created takes the last seat, the form gives way to the limit notice but
 * the link stays on screen.
 */
export function InviteMemberForm({ action, roles, fullMessage = null }: { action: InviteAction; roles: readonly InvitableRole[]; fullMessage?: string | null }) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const [copyStatus, setCopyStatus] = useState<{ link: string; text: string } | null>(null);
  useFocusFirstError(formRef, state);
  const copy = TEAM_COPY.invite;
  const invitation = state.invitation;

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopyStatus({ link, text: copy.copied });
    } catch {
      linkRef.current?.select();
      setCopyStatus({ link, text: copy.copyFailed });
    }
  }

  return (
    <div className="grid gap-5">
      {fullMessage ? <Notice tone="warning">{fullMessage}</Notice> : null}
      <form ref={formRef} action={formAction} className="grid gap-5" noValidate aria-describedby="invite-status" hidden={fullMessage !== null}>
        <TextField id="invite-email" name="email" type="email" label={copy.email} hint={copy.emailHint} autoComplete="off" inputMode="email" maxLength={254} required defaultValue={state.status === "error" ? state.values?.email : ""} error={state.fieldErrors?.email} />
        <SelectField id="invite-role" name="role" label={copy.role} defaultValue={state.values?.role ?? "editor"} hint={TEAM_COPY.roleHelp.editor}>
          {roles.map((role) => <option key={role} value={role}>{APP_COPY.roles[role]}</option>)}
        </SelectField>
        <FormStatus id="invite-status" state={state.fieldErrors?.email ? { status: "idle" } : state} />
        <Button type="submit" loading={pending} className="w-full sm:w-fit">{copy.submit}</Button>
      </form>
      {fullMessage && state.status === "success" ? <FormStatus state={state} /> : null}

      {invitation ? (
        <section className="grid gap-3 rounded-2xl border border-app-border bg-app-surface-soft p-4" aria-label={copy.linkLabel(invitation.email)}>
          <div className="ui-field">
            <label htmlFor="invite-link">{copy.linkLabel(invitation.email)}</label>
            <input ref={linkRef} id="invite-link" className="ui-input" value={invitation.link} readOnly onFocus={(event) => event.currentTarget.select()} aria-describedby="invite-link-hint" />
            <p className="ui-hint" id="invite-link-hint">{copy.expires(formatDateTime(invitation.expiresAt))}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => void copyLink(invitation.link)}>{copy.copy}</Button>
            <span role="status" aria-live="polite" className="text-sm font-bold">{copyStatus?.link === invitation.link ? copyStatus.text : ""}</span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
