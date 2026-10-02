"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_COPY, BLOCKS_COPY, EDITOR_COPY, MEDIA_COPY, PUBLISHING_COPY, THEME_COPY } from "@/content/pt-BR";
import type { FormState } from "@/lib/form-state";
import { BLOCK_TYPES, MAX_BLOCKS, type BlockField, type BlockType, type DraftBlock } from "@/modules/blocks";
import type { UploadedMedia } from "@/modules/media/service";
import { avatarSources } from "@/modules/media/url";
import { initialsFor } from "@/modules/profiles/content";
import type { TemplateDefinition } from "@/modules/themes/templates";
import type { ThemeTokens } from "@/modules/themes/tokens";
import { BIO_MAX_LENGTH } from "@/modules/profiles/content";
import { loadDraftAction } from "@/modules/profiles/actions";
import { PublishForm } from "@/modules/publishing/components/publish-form";
import { documentFromDraft } from "@/modules/publishing/document";
import { PublicPageView } from "@/modules/publishing/render/public-page-view";
import { publicationState, type PublicationSummary } from "@/modules/publishing/service";
import { Badge, Button, Dialog, DialogActions, EmptyState, TextAreaField, TextField } from "@/ui";
import type { AutosaveSnapshot, SaveFailure } from "../draft/autosave";
import { checkDraft, editorReducer, type DraftCheck, editorStateFromDraft, isStructuralAction, isViewOnlyAction, previewDraft, type EditorAction, type EditorState, type MoveTarget } from "../draft/state";
import { AppearancePanel } from "./appearance-panel";
import { BlockCard } from "./block-card";
import { ImageUploader } from "./image-uploader";
import { StorageUsage } from "./storage-usage";
import { useAutosave } from "./use-autosave";

type PublishAction = (previous: FormState, formData: FormData) => Promise<FormState>;

export interface BlockEditorProps {
  profileId: string;
  initial: { title: string; bio: string; avatarPath: string | null; theme: ThemeTokens | null; blocks: DraftBlock[]; revision: number };
  livePublicationId: string | null;
  publications: PublicationSummary[];
  canPublish: boolean;
  publishAction: PublishAction;
  showBadge: boolean;
}

const UNDO_WINDOW_MS = 10_000;
const HEADER_FRESH_KEY = "header";
const AVATAR_UPLOAD_KEY = "avatar";

const STATUS_TONE = { saved: "success", dirty: "warning", invalid: "warning", saving: "neutral", retrying: "warning", error: "danger", conflict: "danger" } as const;
const PUBLICATION_TONE = { never: "neutral", live_current: "success", live_outdated: "warning", offline: "warning" } as const;

/** Identity of a derived draft, to skip autosave when an action changed nothing that is stored. */
function serializeCheck(check: DraftCheck): string {
  return JSON.stringify(check.ok ? check.draft : null);
}

function failureMessage(failure: SaveFailure | null): string {
  switch (failure) {
    case "validation": return EDITOR_COPY.saveErrors.validation;
    case "forbidden": return EDITOR_COPY.saveErrors.forbidden;
    case "not_found": return EDITOR_COPY.saveErrors.notFound;
    case "unauthenticated": return EDITOR_COPY.saveErrors.sessionExpired;
    default: return EDITOR_COPY.saveErrors.unavailable;
  }
}

function publishBlockedReason(status: AutosaveSnapshot["status"], uploading: boolean): string | null {
  // An image still being sent is not in the draft yet: publishing now would leave it out.
  if (uploading) return EDITOR_COPY.publish.blockedUploading;
  switch (status) {
    case "saved": return null;
    case "invalid": return EDITOR_COPY.publish.blockedInvalid;
    case "conflict": return EDITOR_COPY.publish.blockedConflict;
    case "error": return EDITOR_COPY.publish.blockedError;
    default: return EDITOR_COPY.publish.blockedSaving;
  }
}

/**
 * Block editor (Sprint 4 and 5, ADR 0008/0010). Business rules live in modules/editor/draft (reducer, draft
 * check, autosave) and modules/blocks (validation); this component wires them to the page, manages
 * focus and announcements, and renders the live preview with the public renderer.
 */
export function BlockEditor({ profileId, initial, livePublicationId, publications, canPublish, publishAction, showBadge }: BlockEditorProps) {
  const [state, setState] = useState<EditorState>(() => editorStateFromDraft(initial));
  const stateRef = useRef(state);
  const { autosave, snapshot } = useAutosave(profileId, initial.revision);
  const lastNotified = useRef<string>(serializeCheck(checkDraft(state)));

  const [openId, setOpenId] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set());
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [announcement, setAnnouncement] = useState({ text: "", n: 0 });
  const [confirming, setConfirming] = useState<"load" | "keep" | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [undoPaused, setUndoPaused] = useState(false);
  const [busyUploads, setBusyUploads] = useState<ReadonlySet<string>>(() => new Set());
  const [usageKey, setUsageKey] = useState(0);
  const uploading = busyUploads.size > 0;
  const uploadingRef = useRef(uploading);
  const pendingFocus = useRef<string | null>(null);
  const focusAfterUndo = useRef<string>("editor-add");
  const scrollByMode = useRef<Record<"edit" | "preview", number>>({ edit: 0, preview: 0 });

  const check = useMemo(() => checkDraft(state), [state]);
  const preview = useMemo(() => documentFromDraft(previewDraft(state), EDITOR_COPY.preview.untitled), [state]);

  const announce = useCallback((text: string) => setAnnouncement((previous) => ({ text, n: previous.n + 1 })), []);

  /** Applies an action, then tells autosave about the resulting draft (valid or not). */
  const apply = useCallback((action: EditorAction): EditorState => {
    const current = stateRef.current;
    const next = editorReducer(current, action);
    if (next === current) return current;
    stateRef.current = next;
    setState(next);
    if (isViewOnlyAction(action)) return next;
    const result = checkDraft(next);
    const serialized = serializeCheck(result);
    if (result.ok) {
      if (serialized !== lastNotified.current) autosave.update(result.draft, { immediate: isStructuralAction(action) });
    } else {
      autosave.markInvalid();
    }
    lastNotified.current = serialized;
    return next;
  }, [autosave]);

  const focusLater = (id: string) => { pendingFocus.current = id; };

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    document.getElementById(id)?.focus();
  });

  // Warn before closing the tab, reloading or following an in-app link with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!autosave.hasUnsavedChanges() && !uploadingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
      const warning = uploadingRef.current ? EDITOR_COPY.leaveWarningUpload : autosave.hasUnsavedChanges() ? EDITOR_COPY.leaveWarning : null;
      if (warning && !window.confirm(warning)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [autosave]);

  // Undo window: the toast disappears after 10 s unless the person is using it.
  useEffect(() => {
    if (!state.lastDeleted || undoPaused) return;
    const timer = window.setTimeout(() => {
      const undoHadFocus = document.activeElement?.id === "editor-undo";
      apply({ type: "dismiss_undo" });
      if (undoHadFocus) pendingFocus.current = focusAfterUndo.current;
    }, UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [state.lastDeleted, undoPaused, apply]);

  useEffect(() => { uploadingRef.current = uploading; }, [uploading]);

  const setUploadBusy = useCallback((key: string, busy: boolean) => {
    setBusyUploads((previous) => {
      if (previous.has(key) === busy) return previous;
      const next = new Set(previous);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const total = state.blocks.length;
  const positionOf = (next: EditorState, id: string) => next.blocks.findIndex((block) => block.id === id) + 1;

  function markTouched(key: string) {
    setTouched((previous) => (previous.has(key) ? previous : new Set(previous).add(key)));
  }

  function showErrorFor(blockId: string) {
    return (field: BlockField) => !freshIds.has(blockId) || touched.has(`${blockId}:${field}`);
  }

  function addBlock(type: BlockType) {
    const id = crypto.randomUUID();
    const next = apply({ type: "add", blockType: type, id, afterId: openId });
    if (next.blocks.every((block) => block.id !== id)) return;
    setFreshIds((previous) => new Set(previous).add(id));
    setOpenId(id);
    setPickerOpen(false);
    focusLater(`${id}-first`);
    announce(EDITOR_COPY.announce.added(BLOCKS_COPY.types[type].label, positionOf(next, id), next.blocks.length));
  }

  function move(id: string, to: MoveTarget) {
    const next = apply({ type: "move", id, to });
    const position = positionOf(next, id);
    const atTop = position === 1;
    const atBottom = position === next.blocks.length;
    if (to === "up" || to === "top") focusLater(atTop ? (to === "top" ? `${id}-toggle` : `${id}-down`) : `${id}-up`);
    else focusLater(atBottom ? (to === "bottom" ? `${id}-toggle` : `${id}-up`) : `${id}-down`);
    announce(EDITOR_COPY.announce.moved(position, next.blocks.length));
  }

  function duplicate(id: string) {
    const newId = crypto.randomUUID();
    const next = apply({ type: "duplicate", id, newId });
    if (next.blocks.every((block) => block.id !== newId)) return;
    setOpenId(newId);
    focusLater(`${newId}-toggle`);
    announce(EDITOR_COPY.announce.duplicated(positionOf(next, newId), next.blocks.length));
  }

  function toggleVisible(id: string) {
    const next = apply({ type: "toggle_visible", id });
    const block = next.blocks.find((item) => item.id === id);
    announce(block?.visible ? EDITOR_COPY.announce.shown : EDITOR_COPY.announce.hidden);
  }

  function remove(id: string) {
    const index = state.blocks.findIndex((block) => block.id === id);
    const next = apply({ type: "delete", id });
    const neighbor = next.blocks[index] ?? next.blocks[index - 1];
    focusAfterUndo.current = neighbor ? `${neighbor.id}-toggle` : "editor-add";
    if (openId === id) setOpenId(null);
    setUndoPaused(false);
    focusLater("editor-undo");
    announce(EDITOR_COPY.announce.deleted);
  }

  function undo() {
    const restoredId = state.lastDeleted?.block.id;
    const next = apply({ type: "undo_delete" });
    if (!restoredId || next.blocks.every((block) => block.id !== restoredId)) return;
    focusLater(`${restoredId}-toggle`);
    announce(EDITOR_COPY.announce.restored(positionOf(next, restoredId)));
  }

  function imageUploaded(blockId: string, media: UploadedMedia) {
    const block = stateRef.current.blocks.find((item) => item.id === blockId);
    if (!block || block.input.type !== "image") return;
    apply({ type: "set_input", id: blockId, input: { ...block.input, mediaId: media.mediaId, width: media.width, height: media.height } });
    setUsageKey((key) => key + 1);
    announce(MEDIA_COPY.image.added);
  }

  function avatarUploaded(media: UploadedMedia) {
    apply({ type: "set_avatar", mediaId: media.mediaId });
    setUsageKey((key) => key + 1);
    announce(MEDIA_COPY.avatar.added);
  }

  function removeAvatar() {
    apply({ type: "set_avatar", mediaId: null });
    focusLater("editor-avatar-pick");
    announce(MEDIA_COPY.avatar.removed);
  }

  function applyTemplate(template: TemplateDefinition, withExamples: boolean) {
    const ids = template.examples.map(() => crypto.randomUUID());
    const next = apply({ type: "apply_template", templateId: template.id, withExamples, ids });
    const examples = next.lastTemplate?.exampleIds ?? [];
    if (examples.length > 0) setFreshIds((previous) => new Set([...previous, ...examples]));
    focusLater("template-undo");
    announce(THEME_COPY.templates.applied(template.name));
  }

  function undoTemplate() {
    const templateId = stateRef.current.lastTemplate?.templateId;
    apply({ type: "undo_template" });
    if (templateId) focusLater(`template-${templateId}`);
    announce(THEME_COPY.templates.undone);
  }

  function setTheme(theme: ThemeTokens | null) {
    apply({ type: "set_theme", theme });
    if (theme === null) {
      focusLater("theme-customize");
      announce(THEME_COPY.resetDone);
    }
  }

  function switchMode(next: "edit" | "preview") {
    if (next === mode) return;
    scrollByMode.current[mode] = window.scrollY;
    setMode(next);
    requestAnimationFrame(() => window.scrollTo({ top: scrollByMode.current[next] }));
  }

  async function resolveConflict(choice: "load" | "keep") {
    setConflictBusy(true);
    setConflictError(null);
    let result: Awaited<ReturnType<typeof loadDraftAction>>;
    try {
      result = await loadDraftAction(profileId);
    } catch {
      result = { ok: false };
    }
    setConflictBusy(false);
    setConfirming(null);
    if (!result.ok) {
      setConflictError(EDITOR_COPY.conflict.failed);
      return;
    }
    if (choice === "keep") {
      autosave.keepMine(result.draft.revision);
      return;
    }
    const next = editorReducer(stateRef.current, { type: "replace", draft: result.draft });
    stateRef.current = next;
    setState(next);
    lastNotified.current = serializeCheck(checkDraft(next));
    autosave.reset(result.draft.revision);
    setOpenId(null);
    setFreshIds(new Set());
    setTouched(new Set());
    announce(EDITOR_COPY.announce.loadedLatest);
  }

  const publication = publicationState({ draftRevision: snapshot.revision, livePublicationId }, publications);
  const blockedReason = publishBlockedReason(snapshot.status, uploading);
  const headerErrors = check.ok ? {} : check.header;
  const showHeaderError = (field: "title" | "bio") => touched.has(`${HEADER_FRESH_KEY}:${field}`) || state[field] !== initial[field];

  const statusText = snapshot.status === "error" ? `${EDITOR_COPY.status.error} ${failureMessage(snapshot.failure)}` : EDITOR_COPY.status[snapshot.status];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div role="group" aria-label={EDITOR_COPY.view.label} className="flex rounded-xl bg-app-surface-soft p-1 lg:hidden">
        <button type="button" className={`ui-button flex-1 ${mode === "edit" ? "ui-button-primary" : "ui-button-ghost"}`} aria-pressed={mode === "edit"} onClick={() => switchMode("edit")}>{EDITOR_COPY.view.edit}</button>
        <button type="button" className={`ui-button flex-1 ${mode === "preview" ? "ui-button-primary" : "ui-button-ghost"}`} aria-pressed={mode === "preview"} onClick={() => switchMode("preview")}>{EDITOR_COPY.view.preview}</button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className={`${mode === "preview" ? "hidden lg:grid" : "grid"} min-w-0 grid-cols-[minmax(0,1fr)] gap-6`}>
          {snapshot.status === "conflict" ? (
            <section className="grid gap-3 rounded-2xl border border-app-danger/40 bg-app-danger/10 p-4 sm:p-5" aria-labelledby="conflict-title">
              <h2 id="conflict-title" className="m-0 text-lg font-bold">{EDITOR_COPY.conflict.title}</h2>
              <p className="m-0">{EDITOR_COPY.conflict.lead}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => setConfirming("load")}>{EDITOR_COPY.conflict.loadLatest}</Button>
                <Button type="button" variant="secondary" disabled={!check.ok} onClick={() => setConfirming("keep")}>{EDITOR_COPY.conflict.keepMine}</Button>
              </div>
              {!check.ok ? <p className="m-0 text-sm">{EDITOR_COPY.publish.blockedInvalid}</p> : null}
              {conflictError ? <p role="alert" className="m-0 font-bold text-app-danger">{conflictError}</p> : null}
            </section>
          ) : null}

          <section className="surface-card grid gap-4 p-4 sm:p-6" aria-labelledby="editor-header-title">
            <h2 id="editor-header-title" className="m-0 text-xl font-bold">{EDITOR_COPY.headerSection}</h2>
            <TextField id="editor-title" label={APP_COPY.profileForm.title} hint={APP_COPY.profileForm.titleHint} value={state.title} maxLength={120} error={showHeaderError("title") ? headerErrors.title : undefined} onChange={(event) => apply({ type: "set_header", field: "title", value: event.target.value })} onBlur={() => markTouched(`${HEADER_FRESH_KEY}:title`)} />
            <div className="grid gap-3" role="group" aria-labelledby="editor-avatar-title">
              <div className="grid gap-1">
                <p id="editor-avatar-title" className="ui-label m-0">{MEDIA_COPY.avatar.title}</p>
                <p className="ui-hint">{MEDIA_COPY.avatar.hint}</p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                {state.avatarPath ? (
                  <picture className="block h-20 w-20 shrink-0">
                    <img {...avatarSources(state.avatarPath)} className="h-20 w-20 rounded-full border border-app-border object-cover" width={80} height={80} alt={MEDIA_COPY.avatar.current} />
                  </picture>
                ) : (
                  <span aria-hidden="true" className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-app-accent text-2xl font-bold text-white">{initialsFor(state.title)}</span>
                )}
                {state.avatarPath ? <Button type="button" variant="secondary" id="editor-avatar-remove" onClick={removeAvatar}>{MEDIA_COPY.avatar.remove}</Button> : null}
              </div>
              <ImageUploader id="editor-avatar" pickId="editor-avatar-pick" profileId={profileId} kind="avatar" hasImage={state.avatarPath !== null} labels={{ pick: MEDIA_COPY.avatar.upload, replace: MEDIA_COPY.avatar.replace }} onUploaded={avatarUploaded} onBusyChange={(busy) => setUploadBusy(AVATAR_UPLOAD_KEY, busy)} />
              <StorageUsage profileId={profileId} refreshKey={usageKey} />
            </div>
            <TextAreaField id="editor-bio" label={APP_COPY.profileForm.bio} hint={APP_COPY.profileForm.bioHint(Math.max(0, BIO_MAX_LENGTH - state.bio.trim().length))} value={state.bio} rows={3} error={showHeaderError("bio") ? headerErrors.bio : undefined} onChange={(event) => apply({ type: "set_header", field: "bio", value: event.target.value })} onBlur={() => markTouched(`${HEADER_FRESH_KEY}:bio`)} />
          </section>

          <section className="grid grid-cols-[minmax(0,1fr)] gap-4" aria-labelledby="editor-blocks-title">
            <div className="grid gap-1">
              <h2 id="editor-blocks-title" className="m-0 text-xl font-bold">{EDITOR_COPY.blocksSection}</h2>
              <p className="m-0 text-app-muted">{EDITOR_COPY.blocksLead}</p>
            </div>

            {total === 0 ? (
              <EmptyState title={EDITOR_COPY.emptyTitle} description={EDITOR_COPY.emptyDescription} />
            ) : (
              <ol className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0">
                {state.blocks.map((block, index) => (
                  <BlockCard
                    key={block.id}
                    block={block}
                    profileId={profileId}
                    position={index + 1}
                    total={total}
                    open={openId === block.id}
                    check={check.blocks[block.id]}
                    showError={showErrorFor(block.id)}
                    canDuplicate={total < MAX_BLOCKS}
                    onToggleOpen={() => {
                      const opening = openId !== block.id;
                      setOpenId(opening ? block.id : null);
                      if (opening) focusLater(`${block.id}-first`);
                      else apply({ type: "normalize", id: block.id });
                    }}
                    onEdit={(field, value) => apply({ type: "edit", id: block.id, field, value })}
                    onEditSocial={(network, value) => apply({ type: "edit_social", id: block.id, network, value })}
                    onSetInput={(input) => apply({ type: "set_input", id: block.id, input })}
                    onUploadBusy={(busy) => setUploadBusy(block.id, busy)}
                    onImageUploaded={(media) => imageUploaded(block.id, media)}
                    onBlur={(field) => {
                      markTouched(`${block.id}:${field}`);
                      apply({ type: "normalize", id: block.id });
                    }}
                    onMove={(to) => move(block.id, to)}
                    onDuplicate={() => duplicate(block.id)}
                    onToggleVisible={() => toggleVisible(block.id)}
                    onDelete={() => remove(block.id)}
                  />
                ))}
              </ol>
            )}

            {total < MAX_BLOCKS ? (
              <div className="grid gap-3">
                <Button type="button" id="editor-add" variant="secondary" className="w-full sm:w-fit" aria-expanded={pickerOpen} aria-controls="editor-add-picker" onClick={() => setPickerOpen((open) => !open)}>
                  + {EDITOR_COPY.addBlock}
                </Button>
                {pickerOpen ? (
                  <div id="editor-add-picker" role="group" aria-labelledby="editor-add-title" className="surface-card grid gap-3 p-4">
                    <p id="editor-add-title" className="m-0 font-bold">{EDITOR_COPY.addBlockTitle}</p>
                    <p className="m-0 text-sm text-app-muted">{EDITOR_COPY.addBlockLead}</p>
                    <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
                      {BLOCK_TYPES.map((type, index) => (
                        <li key={type}>
                          <button type="button" id={index === 0 ? "editor-add-first" : undefined} className="grid min-h-11 w-full gap-1 rounded-xl border border-app-border p-3 text-left hover:border-app-accent hover:bg-app-accent-soft" onClick={() => addBlock(type)}>
                            <span className="font-bold">{BLOCKS_COPY.types[type].label}</span>
                            <span className="text-sm text-app-muted">{BLOCKS_COPY.types[type].description}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="m-0 text-app-muted">{EDITOR_COPY.blockLimit}</p>
            )}
            {!check.ok && check.limit === "too_large" ? <p role="alert" className="m-0 font-bold text-app-danger">{EDITOR_COPY.payloadLimit}</p> : null}
          </section>

          <AppearancePanel theme={state.theme} hasBlocks={total > 0} lastTemplate={state.lastTemplate} onSetTheme={setTheme} onApplyTemplate={applyTemplate} onUndoTemplate={undoTemplate} />
        </div>

        <aside className={`${mode === "edit" ? "hidden lg:grid" : "grid"} gap-3 lg:sticky lg:top-4`} aria-labelledby="editor-preview-title">
          <h2 id="editor-preview-title" className="m-0 text-lg font-bold">{EDITOR_COPY.preview.title}</h2>
          <p className="m-0 rounded-xl border border-app-warning/30 bg-app-warning/10 p-3 text-sm font-bold text-app-warning">{EDITOR_COPY.preview.banner}</p>
          <div className="overflow-hidden rounded-[2rem] border-8 border-app-text bg-app-bg shadow-raised">
            <div className="max-h-[70vh] overflow-y-auto lg:max-h-[calc(100vh-12rem)]" tabIndex={0} role="region" aria-label={EDITOR_COPY.preview.title}>
              <PublicPageView as="div" document={preview} showBadge={showBadge} interactive={false} />
            </div>
          </div>
        </aside>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 border-t border-app-border bg-app-surface px-4 py-3 shadow-raised sm:mx-0 sm:rounded-t-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid min-h-11 min-w-0 flex-1 content-center gap-1">
            <p role="status" aria-live="polite" className="m-0 flex flex-wrap items-center gap-2">
              <span aria-hidden="true"><Badge tone={STATUS_TONE[snapshot.status]}>{EDITOR_COPY.status[snapshot.status]}</Badge></span>
              <span className="sr-only">{statusText}</span>
              {snapshot.status === "error" ? <span className="text-sm font-bold text-app-danger" aria-hidden="true">{failureMessage(snapshot.failure)}</span> : null}
            </p>
            <span className="flex flex-wrap items-center gap-2 text-sm text-app-muted">
              <Badge tone={PUBLICATION_TONE[publication]}>{PUBLISHING_COPY.badge[publication]}</Badge>
            </span>
          </div>
          {snapshot.status === "error" ? <Button type="button" variant="secondary" onClick={() => autosave.flush()}>{EDITOR_COPY.status.retry}</Button> : null}
          {canPublish ? (
            <PublishForm action={publishAction} draftRevision={snapshot.revision} upToDate={publication === "live_current" && snapshot.status === "saved" && !uploading} hasPublished={publications.length > 0} blockedReason={blockedReason} />
          ) : null}
        </div>
      </div>

      <p aria-live="polite" className="sr-only"><span key={announcement.n}>{announcement.text}</span></p>

      {state.lastDeleted ? (
        <div className="fixed inset-x-4 bottom-28 z-40 flex items-center justify-between gap-3 rounded-xl border border-app-border bg-app-surface p-3 shadow-raised sm:inset-x-auto sm:right-6 sm:w-96" onMouseEnter={() => setUndoPaused(true)} onMouseLeave={() => setUndoPaused(false)} onFocus={() => setUndoPaused(true)} onBlur={() => setUndoPaused(false)} onKeyDown={(event) => { if (event.key === "Escape") { apply({ type: "dismiss_undo" }); focusLater(focusAfterUndo.current); } }}>
          <span className="font-bold">{EDITOR_COPY.undo.deleted}</span>
          <Button type="button" id="editor-undo" variant="secondary" onClick={undo}>{EDITOR_COPY.undo.action}</Button>
        </div>
      ) : null}

      <Dialog open={confirming === "load"} onClose={() => setConfirming(null)} title={EDITOR_COPY.conflict.loadLatestConfirmTitle}>
        <p className="m-0">{EDITOR_COPY.conflict.loadLatestConfirm}</p>
        <DialogActions>
          <Button type="button" variant="secondary" onClick={() => setConfirming(null)}>{EDITOR_COPY.conflict.cancel}</Button>
          <Button type="button" variant="danger" loading={conflictBusy} onClick={() => void resolveConflict("load")}>{EDITOR_COPY.conflict.loadLatestAction}</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={confirming === "keep"} onClose={() => setConfirming(null)} title={EDITOR_COPY.conflict.keepMineConfirmTitle}>
        <p className="m-0">{EDITOR_COPY.conflict.keepMineConfirm}</p>
        <DialogActions>
          <Button type="button" variant="secondary" onClick={() => setConfirming(null)}>{EDITOR_COPY.conflict.cancel}</Button>
          <Button type="button" variant="danger" loading={conflictBusy} onClick={() => void resolveConflict("keep")}>{EDITOR_COPY.conflict.keepMineAction}</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
