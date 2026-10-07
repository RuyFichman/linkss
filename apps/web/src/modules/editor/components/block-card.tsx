"use client";

import { BLOCKS_COPY, EDITOR_COPY } from "@/content/pt-BR";
import type { BlockField, BlockInput, SocialNetwork } from "@/modules/blocks";
import type { UploadedMedia } from "@/modules/media/service";
import { Badge, Button } from "@/ui";
import type { BlockCheck, EditorBlock, MoveTarget, TextBlockField } from "../draft/state";
import { blockSummary } from "../draft/summary";
import { BlockFields } from "./block-fields";
import { StudioIcon } from "./studio-icons";

export interface BlockCardProps {
  block: EditorBlock;
  position: number;
  total: number;
  check: BlockCheck | undefined;
  onOpen: () => void;
  onMove: (to: MoveTarget) => void;
}

/**
 * One block in the editor list: type, summary, state badges and move buttons (the accessible
 * alternative to dragging). Opening it shows `BlockEditView`. Element ids follow
 * `${block.id}-<action>` so the editor can restore focus.
 */
export function BlockCard({ block, position, total, check, onOpen, onMove }: BlockCardProps) {
  const typeLabel = BLOCKS_COPY.types[block.input.type].label;
  const name = EDITOR_COPY.blockName(typeLabel, position);
  const invalid = check !== undefined && !check.valid;

  return (
    <li className="studio-row" data-hidden={block.visible ? undefined : ""} data-block-card={block.id}>
      <button type="button" id={`${block.id}-toggle`} className="studio-row-main" onClick={onOpen}>
        <span className="studio-row-icon"><StudioIcon name={block.input.type} /></span>
        <span className="studio-row-text">
          {/* The visible text stays part of the accessible name (WCAG 2.5.3 label in name). */}
          <span className="sr-only">{EDITOR_COPY.actions.editPrefix} </span>
          <span className="studio-row-label">{blockSummary(block.input)}</span>
          <span className="studio-row-note flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{position}. {typeLabel}</span>
            {!block.visible ? <Badge tone="neutral">{EDITOR_COPY.hiddenBadge}</Badge> : null}
            {invalid ? <Badge tone="danger">{EDITOR_COPY.invalidBadge}</Badge> : null}
          </span>
        </span>
      </button>
      <div className="studio-row-actions">
        <button type="button" id={`${block.id}-up`} className="studio-icon-button" aria-label={EDITOR_COPY.actions.moveUp(name)} title={EDITOR_COPY.actions.moveUp(name)} disabled={position === 1} onClick={() => onMove("up")}>
          <StudioIcon name="up" />
        </button>
        <button type="button" id={`${block.id}-down`} className="studio-icon-button" aria-label={EDITOR_COPY.actions.moveDown(name)} title={EDITOR_COPY.actions.moveDown(name)} disabled={position === total} onClick={() => onMove("down")}>
          <StudioIcon name="down" />
        </button>
      </div>
    </li>
  );
}

export interface BlockEditViewProps {
  block: EditorBlock;
  profileId: string;
  position: number;
  total: number;
  check: BlockCheck | undefined;
  showError: (field: BlockField) => boolean;
  canAdd: boolean;
  onEdit: (field: TextBlockField, value: string) => void;
  onEditSocial: (network: SocialNetwork, value: string) => void;
  onSetInput: (input: BlockInput) => void;
  onUploadBusy: (busy: boolean) => void;
  onImageUploaded: (media: UploadedMedia) => void;
  onBlur: (field: BlockField) => void;
  onMove: (to: MoveTarget) => void;
  onDuplicate: () => void;
  onToggleVisible: () => void;
  onAddAfter: () => void;
}

/** The form of the open block plus duplicate, hide/show, move to top/bottom and add after. */
export function BlockEditView(props: BlockEditViewProps) {
  const { block, position, total, check } = props;
  const name = EDITOR_COPY.blockName(BLOCKS_COPY.types[block.input.type].label, position);
  const invalid = check !== undefined && !check.valid;

  return (
    <div id={`${block.id}-panel`} className="grid grid-cols-[minmax(0,1fr)] gap-4" role="group" aria-label={name}>
      {!block.visible || invalid ? (
        <p className="m-0 flex flex-wrap gap-2">
          {!block.visible ? <Badge tone="neutral">{EDITOR_COPY.hiddenBadge}</Badge> : null}
          {invalid ? <Badge tone="danger">{EDITOR_COPY.invalidBadge}</Badge> : null}
        </p>
      ) : null}
      <section className="studio-group" aria-labelledby={`${block.id}-content-title`}>
        <h3 id={`${block.id}-content-title`} className="studio-group-head">{EDITOR_COPY.studio.groups.content}</h3>
        <div className="studio-group-body">
          <BlockFields
            blockId={block.id}
            profileId={props.profileId}
            input={block.input}
            errors={check?.errors ?? {}}
            notices={check?.notices ?? {}}
            showError={props.showError}
            onEdit={props.onEdit}
            onEditSocial={props.onEditSocial}
            onSetInput={props.onSetInput}
            onUploadBusy={props.onUploadBusy}
            onImageUploaded={props.onImageUploaded}
            onBlur={props.onBlur}
          />
        </div>
      </section>
      <section className="studio-group" aria-labelledby={`${block.id}-arrange-title`}>
        <h3 id={`${block.id}-arrange-title`} className="studio-group-head">{EDITOR_COPY.studio.groups.arrange}</h3>
        <div className="studio-group-body">
          <div className="studio-group-actions">
            <Button type="button" variant="secondary" id={`${block.id}-duplicate`} aria-label={EDITOR_COPY.actions.duplicateLabel(name)} disabled={!props.canAdd} onClick={props.onDuplicate}>{EDITOR_COPY.actions.duplicate}</Button>
            <Button type="button" variant="secondary" id={`${block.id}-visibility`} aria-label={block.visible ? EDITOR_COPY.actions.hideLabel(name) : EDITOR_COPY.actions.showLabel(name)} onClick={props.onToggleVisible}>{block.visible ? EDITOR_COPY.actions.hide : EDITOR_COPY.actions.show}</Button>
            <Button type="button" variant="secondary" id={`${block.id}-top`} disabled={position === 1} onClick={() => props.onMove("top")}>{EDITOR_COPY.actions.moveTop}</Button>
            <Button type="button" variant="secondary" id={`${block.id}-bottom`} disabled={position === total} onClick={() => props.onMove("bottom")}>{EDITOR_COPY.actions.moveBottom}</Button>
            {props.canAdd ? <Button type="button" variant="secondary" id={`${block.id}-add-after`} onClick={props.onAddAfter}>{EDITOR_COPY.studio.addAfter}</Button> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
