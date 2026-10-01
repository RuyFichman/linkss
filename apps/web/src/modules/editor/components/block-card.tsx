"use client";

import { BLOCKS_COPY, EDITOR_COPY } from "@/content/pt-BR";
import type { BlockField, SocialNetwork } from "@/modules/blocks";
import { Badge, Button } from "@/ui";
import type { BlockCheck, EditorBlock, MoveTarget, TextBlockField } from "../draft/state";
import { blockSummary } from "../draft/summary";
import { BlockFields } from "./block-fields";

export interface BlockCardProps {
  block: EditorBlock;
  position: number;
  total: number;
  open: boolean;
  check: BlockCheck | undefined;
  showError: (field: BlockField) => boolean;
  onToggleOpen: () => void;
  onEdit: (field: TextBlockField, value: string) => void;
  onEditSocial: (network: SocialNetwork, value: string) => void;
  onBlur: (field: BlockField) => void;
  onMove: (to: MoveTarget) => void;
  onDuplicate: () => void;
  onToggleVisible: () => void;
  onDelete: () => void;
  canDuplicate: boolean;
}

function Arrow({ direction }: { direction: "up" | "down" }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden focusable={false} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      {direction === "up" ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
    </svg>
  );
}

/**
 * One block in the editor list. Collapsed: type, summary, state badges and move buttons (the
 * accessible alternative to dragging). Open: the form plus duplicate, hide/show, move to top/bottom
 * and delete. Element ids follow `${block.id}-<action>` so the editor can restore focus.
 */
export function BlockCard(props: BlockCardProps) {
  const { block, position, total, open, check } = props;
  const typeLabel = BLOCKS_COPY.types[block.input.type].label;
  const name = EDITOR_COPY.blockName(typeLabel, position);
  const invalid = check !== undefined && !check.valid;
  const isFirst = position === 1;
  const isLast = position === total;

  return (
    <li className={`surface-card grid grid-cols-[minmax(0,1fr)] gap-3 p-3 sm:p-4 ${block.visible ? "" : "border-dashed bg-app-surface-soft"}`} data-block-card={block.id}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          id={`${block.id}-toggle`}
          className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 rounded-lg px-2 py-1 text-left hover:bg-app-surface-soft"
          aria-expanded={open}
          aria-controls={`${block.id}-panel`}
          onClick={props.onToggleOpen}
        >
          {/* The visible text stays part of the accessible name (WCAG 2.5.3 label in name). */}
          <span className="sr-only">{EDITOR_COPY.actions.editPrefix} </span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wide text-app-muted">{position}. {typeLabel}</span>
            {!block.visible ? <Badge tone="neutral">{EDITOR_COPY.hiddenBadge}</Badge> : null}
            {invalid ? <Badge tone="danger">{EDITOR_COPY.invalidBadge}</Badge> : null}
          </span>
          <span className="w-full truncate font-bold">{blockSummary(block.input)}</span>
        </button>
        <div className="flex shrink-0 gap-1">
          <button type="button" id={`${block.id}-up`} className="ui-button ui-button-secondary ui-icon-button" aria-label={EDITOR_COPY.actions.moveUp(name)} title={EDITOR_COPY.actions.moveUp(name)} disabled={isFirst} onClick={() => props.onMove("up")}>
            <Arrow direction="up" />
          </button>
          <button type="button" id={`${block.id}-down`} className="ui-button ui-button-secondary ui-icon-button" aria-label={EDITOR_COPY.actions.moveDown(name)} title={EDITOR_COPY.actions.moveDown(name)} disabled={isLast} onClick={() => props.onMove("down")}>
            <Arrow direction="down" />
          </button>
        </div>
      </div>

      {open ? (
        <div id={`${block.id}-panel`} className="grid gap-4 border-t border-app-border pt-4" role="group" aria-label={name}>
          <BlockFields
            blockId={block.id}
            input={block.input}
            errors={check?.errors ?? {}}
            notices={check?.notices ?? {}}
            showError={props.showError}
            onEdit={props.onEdit}
            onEditSocial={props.onEditSocial}
            onBlur={props.onBlur}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" id={`${block.id}-duplicate`} aria-label={EDITOR_COPY.actions.duplicateLabel(name)} disabled={!props.canDuplicate} onClick={props.onDuplicate}>{EDITOR_COPY.actions.duplicate}</Button>
            <Button type="button" variant="secondary" id={`${block.id}-visibility`} aria-label={block.visible ? EDITOR_COPY.actions.hideLabel(name) : EDITOR_COPY.actions.showLabel(name)} onClick={props.onToggleVisible}>{block.visible ? EDITOR_COPY.actions.hide : EDITOR_COPY.actions.show}</Button>
            <Button type="button" variant="secondary" id={`${block.id}-top`} disabled={isFirst} onClick={() => props.onMove("top")}>{EDITOR_COPY.actions.moveTop}</Button>
            <Button type="button" variant="secondary" id={`${block.id}-bottom`} disabled={isLast} onClick={() => props.onMove("bottom")}>{EDITOR_COPY.actions.moveBottom}</Button>
            <Button type="button" variant="danger" id={`${block.id}-delete`} aria-label={EDITOR_COPY.actions.deleteLabel(name)} onClick={props.onDelete}>{EDITOR_COPY.actions.delete}</Button>
            <Button type="button" variant="ghost" onClick={props.onToggleOpen}>{EDITOR_COPY.actions.done}</Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
