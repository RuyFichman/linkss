"use client";

import { useActionState, useState } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { Badge, Button, FormStatus } from "@/ui";
import type { DraftLinkBlock } from "../draft-content";
import type { ProfileField } from "../service";
import { LinkForm } from "./link-form";

type Action = (previous: FormState) => Promise<FormState<ProfileField>>;
type SaveAction = (previous: FormState, formData: FormData) => Promise<FormState<ProfileField>>;

interface LinkListItemProps {
  link: DraftLinkBlock;
  isFirst: boolean;
  isLast: boolean;
  saveAction: SaveAction;
  removeAction: Action;
  moveUpAction: Action;
  moveDownAction: Action;
}

export function LinkListItem({ link, isFirst, isLast, saveAction, removeAction, moveUpAction, moveDownAction }: LinkListItemProps) {
  const [editing, setEditing] = useState(false);
  const [removeState, remove, removing] = useActionState(removeAction, IDLE_FORM_STATE);
  const [upState, moveUp, movingUp] = useActionState(moveUpAction, IDLE_FORM_STATE);
  const [downState, moveDown, movingDown] = useActionState(moveDownAction, IDLE_FORM_STATE);
  const error = [removeState, upState, downState].find((state) => state.status === "error");

  return (
    <li className="grid gap-3 rounded-xl border border-app-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="grid min-w-0 gap-1">
          <span className="flex flex-wrap items-center gap-2 font-bold break-words">{link.title}{link.visible ? null : <Badge tone="warning">{APP_COPY.links.hidden}</Badge>}</span>
          <span className="text-sm break-all text-app-muted">{link.url}</span>
        </span>
        <span className="flex flex-wrap gap-2">
          <form action={moveUp}>
            <Button type="submit" variant="secondary" className="ui-icon-button" disabled={isFirst} loading={movingUp} aria-label={APP_COPY.links.moveUp(link.title)} title={APP_COPY.links.moveUp(link.title)}>↑</Button>
          </form>
          <form action={moveDown}>
            <Button type="submit" variant="secondary" className="ui-icon-button" disabled={isLast} loading={movingDown} aria-label={APP_COPY.links.moveDown(link.title)} title={APP_COPY.links.moveDown(link.title)}>↓</Button>
          </form>
          <Button type="button" variant="secondary" aria-expanded={editing} onClick={() => setEditing((value) => !value)}>{editing ? APP_COPY.links.cancel : APP_COPY.links.edit}</Button>
          <form action={remove}>
            <Button type="submit" variant="secondary" loading={removing} aria-label={APP_COPY.links.removeLabel(link.title)}>{APP_COPY.links.remove}</Button>
          </form>
        </span>
      </div>
      {error ? <FormStatus state={error} /> : null}
      {editing ? <LinkForm action={saveAction} idPrefix={`link-${link.id}`} initial={{ title: link.title, url: link.url }} submitLabel={APP_COPY.links.save} onDone={() => setEditing(false)} /> : null}
    </li>
  );
}
