"use client";

import { useActionState } from "react";
import { APP_COPY, TEAM_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Button, FormStatus } from "@/ui";
import type { WorkspaceRole } from "../permissions";

type RoleAction = (previous: FormState, formData: FormData) => Promise<FormState>;

/** Role of one member. Only the roles the viewer may grant are offered; the server checks again. */
export function MemberRoleForm({ action, membershipId, name, current, options }: { action: RoleAction; membershipId: string; name: string; current: WorkspaceRole; options: readonly WorkspaceRole[] }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const selectId = `role-${membershipId}`;
  return (
    <form action={formAction} className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="ui-field min-w-40">
          <label htmlFor={selectId}>{TEAM_COPY.changeRole.label(name)}</label>
          <select id={selectId} name="role" className="ui-select" defaultValue={current} key={current}>
            <option value={current}>{APP_COPY.roles[current]}</option>
            {options.map((role) => <option key={role} value={role}>{APP_COPY.roles[role]}</option>)}
          </select>
        </div>
        <Button type="submit" variant="secondary" loading={pending}>{TEAM_COPY.changeRole.submit}</Button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}
