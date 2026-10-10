"use client";

import { Schibsted_Grotesk } from "next/font/google";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
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
import { BlockCard, BlockEditView } from "./block-card";
import { ImageUploader } from "./image-uploader";
import { StorageUsage } from "./storage-usage";
import { StudioIcon } from "./studio-icons";
import { useAutosave } from "./use-autosave";
import { useStudioViewport } from "./use-studio-viewport";
import "./studio.css";

const displayFont = Schibsted_Grotesk({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-studio-display", display: "swap" });

type PublishAction = (previous: FormState, formData: FormData) => Promise<FormState>;

export interface StudioNavLink {
  href: string;
  label: string;
  icon: "results" | "contacts" | "preview" | "external";
  newTab?: boolean;
}

export interface BlockEditorProps {
  profileId: string;
  initial: { title: string; bio: string; avatarPath: string | null; theme: ThemeTokens | null; blocks: DraftBlock[]; revision: number };
  livePublicationId: string | null;
  publications: PublicationSummary[];
  canPublish: boolean;
  publishAction: PublishAction;
  showBadge: boolean;
  /** Public address without the scheme, shown next to the title and on the preview frame. */
  address: string;
  nav: { backHref: string; backLabel: string; links: readonly StudioNavLink[] };
  /** Where a full image quota sends who can buy a larger plan; null keeps the sentence alone (ADR 0014). */
  plansHref?: string | null;
  /** Server-rendered notices for the top of the content list (draft, copy review). */
  notices?: ReactNode;
  /** Server-rendered page settings (publishing history, address, archive, delete) for the "Página" tab. */
  settings: ReactNode;
  /** Opens on the "Página" tab (`?aba=pagina`): a direct address for the page settings. */
  startOnSettings?: boolean;
}

type StudioTab = "content" | "styles" | "page";

const UNDO_WINDOW_MS = 10_000;
const HEADER_FRESH_KEY = "header";
const AVATAR_UPLOAD_KEY = "avatar";
const STUDIO_TABS: readonly StudioTab[] = ["content", "styles", "page"];
const EDIT_TITLE_ID = "editor-edit-title";
const HEADER_TOGGLE_ID = "editor-header-toggle";
const HEADER_BACK_ID = "editor-header-back";
const PICKER_BACK_ID = "editor-add-back";

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
 *
 * Layout (UX-085): mobile dedicates the viewport to editing or preview, with a bottom navigation.
 * Switching to preview keeps the form mounted, including pending uploads and unfinished fields.
 * Wide screens keep the panel and framed preview side by side (UX-072).
 */
export function BlockEditor({ profileId, initial, livePublicationId, publications, canPublish, publishAction, showBadge, address, nav, notices, settings, startOnSettings = false, plansHref = null }: BlockEditorProps) {
  const [state, setState] = useState<EditorState>(() => editorStateFromDraft(initial));
  const stateRef = useRef(state);
  const { autosave, snapshot } = useAutosave(profileId, initial.revision);
  const lastNotified = useRef<string>(serializeCheck(checkDraft(state)));

  const [openId, setOpenId] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set());
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [tab, setTab] = useState<StudioTab>(startOnSettings ? "page" : "content");
  const [mobilePreview, setMobilePreview] = useState(false);
  const studioRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useStudioViewport(studioRef);
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
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
  const previewRef = useRef<HTMLDivElement>(null);
  const revealed = useRef<string | null>(null);

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

  // Start a newly opened form at its beginning, then focus the requested field or list row.
  const panelView = pickerOpen ? "picker" : openId ?? (headerOpen && tab === "content" ? "header" : tab);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0, behavior: "instant" }); }, [panelView]);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const target = document.getElementById(id);
    if (target?.getClientRects().length) target.focus();
    else document.getElementById("editor-screen-title")?.focus();
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

  // Marks what is being edited in the preview and brings it into view once, when it is opened.
  const currentKey = openId ?? (headerOpen && tab === "content" ? HEADER_FRESH_KEY : null);
  useEffect(() => {
    if (!currentKey) {
      revealed.current = null;
      return;
    }
    const selector = currentKey === HEADER_FRESH_KEY ? "article > header" : `[data-block-id="${CSS.escape(currentKey)}"]`;
    const node = previewRef.current?.querySelector(selector);
    if (!node) return;
    node.setAttribute("data-studio-current", "");
    if (revealed.current !== currentKey && node.getClientRects().length > 0) {
      revealed.current = currentKey;
      node.scrollIntoView({ block: "nearest" });
    }
    return () => node.removeAttribute("data-studio-current");
  }, [currentKey, preview, mobilePreview]);

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
    setMobilePreview(false);
    setOpenId(id);
    setPickerOpen(false);
    setHeaderOpen(false);
    focusLater(`${id}-first`);
    announce(EDITOR_COPY.announce.added(BLOCKS_COPY.types[type].label, positionOf(next, id), next.blocks.length));
  }

  function move(id: string, to: MoveTarget) {
    const next = apply({ type: "move", id, to });
    const position = positionOf(next, id);
    const atTop = position === 1;
    const atBottom = position === next.blocks.length;
    // In the block's own view only "top" and "bottom" exist, and the one just used is now disabled.
    if (openId === id) focusLater(to === "top" || to === "up" ? `${id}-bottom` : `${id}-top`);
    else if (to === "up" || to === "top") focusLater(atTop ? (to === "top" ? `${id}-toggle` : `${id}-down`) : `${id}-up`);
    else focusLater(atBottom ? (to === "bottom" ? `${id}-toggle` : `${id}-up`) : `${id}-down`);
    announce(EDITOR_COPY.announce.moved(position, next.blocks.length));
  }

  function duplicate(id: string) {
    const newId = crypto.randomUUID();
    const next = apply({ type: "duplicate", id, newId });
    if (next.blocks.every((block) => block.id !== newId)) return;
    setOpenId(newId);
    focusLater(EDIT_TITLE_ID);
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

  function openBlock(id: string, focusId: string) {
    if (uploading) { setMobilePreview(false); focusLater(openId ? EDIT_TITLE_ID : HEADER_BACK_ID); return; }
    if (openId && openId !== id) apply({ type: "normalize", id: openId });
    setMobilePreview(false);
    setTab("content");
    setPickerOpen(false);
    setHeaderOpen(false);
    setOpenId(id);
    focusLater(focusId);
  }

  function closeBlock(id: string) {
    apply({ type: "normalize", id });
    setOpenId(null);
    focusLater(`${id}-toggle`);
  }

  function openHeader(focusId: string) {
    if (uploading) { setMobilePreview(false); focusLater(openId ? EDIT_TITLE_ID : HEADER_BACK_ID); return; }
    setMobilePreview(false);
    if (openId) apply({ type: "normalize", id: openId });
    setTab("content");
    setPickerOpen(false);
    setOpenId(null);
    setHeaderOpen(true);
    focusLater(focusId);
  }

  function selectTab(next: StudioTab) {
    // Preview keeps the form mounted; returning to the same tab resumes the unfinished edit.
    if (mobilePreview && tab === next) {
      setMobilePreview(false);
      focusLater(openId ? EDIT_TITLE_ID : headerOpen ? HEADER_BACK_ID : "editor-screen-title");
      return;
    }
    if (uploading) return;
    if (openId) apply({ type: "normalize", id: openId });
    setOpenId(null);
    setHeaderOpen(false);
    setPickerOpen(false);
    setTab(next);
    setMobilePreview(false);
    focusLater("editor-screen-title");
  }

  function showMobilePreview() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setMobilePreview(true);
    focusLater("editor-preview-resume");
  }

  function closePicker() {
    setPickerOpen(false);
    focusLater(openId ? `${openId}-add-after` : "editor-add");
  }

  /** Clicking the preview opens what was clicked. The lists in the panel are the keyboard path. */
  function pickInPreview(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as Element;
    const id = target.closest("[data-block-id]")?.getAttribute("data-block-id");
    if (id && stateRef.current.blocks.some((block) => block.id === id)) openBlock(id, EDIT_TITLE_ID);
    else if (target.closest("article > header")) openHeader(HEADER_BACK_ID);
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
    setPickerOpen(false);
    setFreshIds(new Set());
    setTouched(new Set());
    announce(EDITOR_COPY.announce.loadedLatest);
  }

  const publication = publicationState({ draftRevision: snapshot.revision, livePublicationId }, publications);
  const blockedReason = publishBlockedReason(snapshot.status, uploading);
  const headerErrors = check.ok ? {} : check.header;
  const showHeaderError = (field: "title" | "bio") => touched.has(`${HEADER_FRESH_KEY}:${field}`) || state[field] !== initial[field];

  const statusText = snapshot.status === "error" ? `${EDITOR_COPY.status.error} ${failureMessage(snapshot.failure)}` : EDITOR_COPY.status[snapshot.status];

  const openIndex = openId ? state.blocks.findIndex((block) => block.id === openId) : -1;
  const openedBlock = openIndex >= 0 ? state.blocks[openIndex] : undefined;
  const canAdd = total < MAX_BLOCKS;
  const [addressHost, ...addressPath] = address.split("/");

  const picker = (
    <div id="editor-add-picker" className="grid grid-cols-[minmax(0,1fr)] gap-3" role="group" aria-labelledby="editor-add-title">
      <button type="button" id={PICKER_BACK_ID} className="studio-back" aria-label={EDITOR_COPY.studio.back(EDITOR_COPY.addBlock)} onClick={closePicker}>
        <StudioIcon name="back" size={18} />{EDITOR_COPY.addBlock}
      </button>
      <h2 id="editor-add-title" className="studio-heading">{EDITOR_COPY.addBlockTitle}</h2>
      <p className="studio-lead">{openedBlock ? EDITOR_COPY.studio.addLeadAfter : EDITOR_COPY.studio.addLeadEnd}</p>
      <ul className="studio-list studio-picker-grid">
        {BLOCK_TYPES.map((type, index) => (
          <li key={type} className="studio-row">
            <button type="button" id={index === 0 ? "editor-add-first" : undefined} className="studio-row-main" onClick={() => addBlock(type)}>
              <span className="studio-row-icon"><StudioIcon name={type} /></span>
              <span className="studio-row-text">
                <span className="studio-row-label">{BLOCKS_COPY.types[type].label}</span>
                <span className="studio-row-note">{BLOCKS_COPY.types[type].description}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const headerView = (
    <div className="studio-header-view grid grid-cols-[minmax(0,1fr)] gap-4" role="group" aria-labelledby="editor-header-title">
      <button type="button" id={HEADER_BACK_ID} className="studio-back" disabled={uploading} aria-label={EDITOR_COPY.studio.back(EDITOR_COPY.headerSection)} onClick={() => { setHeaderOpen(false); focusLater(HEADER_TOGGLE_ID); }}>
        <StudioIcon name="back" size={18} /><span id="editor-header-title">{EDITOR_COPY.headerSection}</span>
      </button>
      <section className="studio-group" aria-labelledby="editor-header-text">
        <h3 id="editor-header-text" className="studio-group-head">{EDITOR_COPY.studio.groups.text}</h3>
        <div className="studio-group-body">
          <TextField id="editor-title" label={APP_COPY.profileForm.title} hint={APP_COPY.profileForm.titleHint} value={state.title} maxLength={120} error={showHeaderError("title") ? headerErrors.title : undefined} onChange={(event) => apply({ type: "set_header", field: "title", value: event.target.value })} onBlur={() => markTouched(`${HEADER_FRESH_KEY}:title`)} />
          <TextAreaField id="editor-bio" label={APP_COPY.profileForm.bio} hint={APP_COPY.profileForm.bioHint(Math.max(0, BIO_MAX_LENGTH - state.bio.trim().length))} value={state.bio} rows={3} error={showHeaderError("bio") ? headerErrors.bio : undefined} onChange={(event) => apply({ type: "set_header", field: "bio", value: event.target.value })} onBlur={() => markTouched(`${HEADER_FRESH_KEY}:bio`)} />
        </div>
      </section>
      <section className="studio-group" aria-labelledby="editor-avatar-title">
        <h3 id="editor-avatar-title" className="studio-group-head">{MEDIA_COPY.avatar.title}</h3>
        <div className="studio-group-body">
          <p className="ui-hint">{MEDIA_COPY.avatar.hint}</p>
          <div className="flex flex-wrap items-center gap-4">
            {state.avatarPath ? (
              <picture className="block h-20 w-20 shrink-0">
                <img {...avatarSources(state.avatarPath)} className="h-20 w-20 rounded-full border border-app-border object-cover" width={80} height={80} alt={MEDIA_COPY.avatar.current} />
              </picture>
            ) : (
              <span aria-hidden="true" className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-app-accent text-2xl font-bold text-white">{initialsFor(state.title)}</span>
            )}
            {state.avatarPath ? <Button type="button" variant="secondary" id="editor-avatar-remove" disabled={uploading} onClick={removeAvatar}>{MEDIA_COPY.avatar.remove}</Button> : null}
          </div>
          <ImageUploader id="editor-avatar" pickId="editor-avatar-pick" profileId={profileId} kind="avatar" hasImage={state.avatarPath !== null} labels={{ pick: MEDIA_COPY.avatar.upload, replace: MEDIA_COPY.avatar.replace }} onUploaded={avatarUploaded} onBusyChange={(busy) => setUploadBusy(AVATAR_UPLOAD_KEY, busy)} />
          <StorageUsage profileId={profileId} refreshKey={usageKey} plansHref={plansHref} />
        </div>
      </section>
    </div>
  );

  const contentList = (
    <>
      {notices}
      <ul className="studio-list">
        <li className="studio-row">
          <button type="button" id={HEADER_TOGGLE_ID} className="studio-row-main" onClick={() => openHeader("editor-title")}>
            <span className="studio-row-icon"><StudioIcon name="header" /></span>
            <span className="studio-row-text">
              <span className="sr-only">{EDITOR_COPY.actions.editPrefix} </span>
              <span className="studio-row-label">{EDITOR_COPY.headerSection}</span>
              <span className="studio-row-note" data-clip="">{state.title.trim() || EDITOR_COPY.preview.untitled}</span>
            </span>
            <span className="studio-row-icon"><StudioIcon name="chevron" size={18} /></span>
          </button>
        </li>
      </ul>

      <section className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-labelledby="editor-blocks-title">
        <div className="grid gap-1">
          <h2 id="editor-blocks-title" className="studio-heading">{EDITOR_COPY.blocksSection}</h2>
          <p className="studio-lead studio-blocks-lead">{EDITOR_COPY.blocksLead}</p>
        </div>

        {total === 0 ? (
          <EmptyState title={EDITOR_COPY.emptyTitle} description={EDITOR_COPY.emptyDescription} />
        ) : (
          <ol className="studio-list">
            {state.blocks.map((block, index) => (
              <BlockCard key={block.id} block={block} position={index + 1} total={total} check={check.blocks[block.id]} onOpen={() => openBlock(block.id, `${block.id}-first`)} onMove={(to) => move(block.id, to)} />
            ))}
          </ol>
        )}

        <div className="studio-add-slot">
          {canAdd ? (
            <Button type="button" id="editor-add" className="w-full" onClick={() => { setPickerOpen(true); focusLater("editor-add-first"); }}>
              <StudioIcon name="plus" size={18} />{EDITOR_COPY.addBlock}
            </Button>
          ) : (
            <p className="studio-lead">{EDITOR_COPY.blockLimit}</p>
          )}
        </div>
        {!check.ok && check.limit === "too_large" ? <p role="alert" className="m-0 font-bold text-app-danger">{EDITOR_COPY.payloadLimit}</p> : null}
      </section>
    </>
  );

  return (
    <div ref={studioRef} className={`studio ${displayFont.variable}`} data-mobile-view={mobilePreview ? "preview" : "edit"}>
      <nav className="studio-nav" aria-label={EDITOR_COPY.studio.nav}>
        <Link className="studio-nav-link" href={nav.backHref} aria-label={nav.backLabel} title={nav.backLabel}><StudioIcon name="back" size={22} /></Link>
        <span className="studio-nav-divider" aria-hidden="true" />
        {nav.links.map((link) => (
          <Link key={link.href} className="studio-nav-link studio-nav-extra" href={link.href} aria-label={link.label} title={link.label} {...(link.newTab ? { target: "_blank", rel: "noopener", prefetch: false } : {})}>
            <StudioIcon name={link.icon} size={22} />
          </Link>
        ))}
      </nav>

      <header className="studio-head">
        <div className="studio-title">
          <h1>{state.title.trim() || EDITOR_COPY.preview.untitled}</h1>
          <p className="studio-address">{address}</p>
          <div className="studio-status">
            <p role="status" aria-live="polite" className="m-0 flex flex-wrap items-center gap-2">
              <span aria-hidden="true"><Badge tone={STATUS_TONE[snapshot.status]}>{EDITOR_COPY.status[snapshot.status]}</Badge></span>
              <span className="sr-only">{statusText}</span>
              {snapshot.status === "error" ? <span className="studio-status-detail" aria-hidden="true">{failureMessage(snapshot.failure)}</span> : null}
            </p>
            {/* On phones the publish button already says this; it stays when there is no button. */}
            <span className={canPublish ? "studio-publication" : undefined}><Badge tone={PUBLICATION_TONE[publication]}>{PUBLISHING_COPY.badge[publication]}</Badge></span>
          </div>
        </div>
        {snapshot.status === "error" ? <Button type="button" className="studio-retry" variant="secondary" onClick={() => autosave.flush()}>{EDITOR_COPY.status.retry}</Button> : null}
        {canPublish ? (
          <PublishForm action={publishAction} draftRevision={snapshot.revision} upToDate={publication === "live_current" && snapshot.status === "saved" && !uploading} hasPublished={publications.length > 0} blockedReason={blockedReason} />
        ) : null}
        {snapshot.status === "error" ? <p className="studio-mobile-error">{failureMessage(snapshot.failure)}</p> : null}
      </header>

      <section id="editor-panel" className="studio-panel" data-view={panelView} aria-label={EDITOR_COPY.studio.panel}>
        <div className="studio-mobile-heading">
          {openedBlock || headerOpen || pickerOpen ? (
            <button type="button" className="studio-icon-button" disabled={uploading} aria-label={EDITOR_COPY.studio.mobile.back} onClick={() => {
              if (pickerOpen) closePicker();
              else if (openedBlock) closeBlock(openedBlock.id);
              else { setHeaderOpen(false); focusLater(HEADER_TOGGLE_ID); }
            }}><StudioIcon name="back" /></button>
          ) : null}
          <h2 id="editor-screen-title" tabIndex={-1}>{pickerOpen ? EDITOR_COPY.addBlock : openedBlock ? BLOCKS_COPY.types[openedBlock.input.type].label : headerOpen ? EDITOR_COPY.headerSection : EDITOR_COPY.studio.tabs[tab]}</h2>
          <button type="button" className="studio-icon-button" aria-label={EDITOR_COPY.studio.mobile.preview} onClick={showMobilePreview}><StudioIcon name="preview" /></button>
        </div>

        {openedBlock ? (
          pickerOpen ? null : (
            <div className="studio-edit-head">
              <button type="button" className="studio-icon-button studio-mobile-back" disabled={uploading} aria-label={EDITOR_COPY.studio.mobile.back} onClick={() => closeBlock(openedBlock.id)}><StudioIcon name="back" /></button>
              <div>
                <p className="studio-eyebrow">{EDITOR_COPY.studio.editing(openIndex + 1, total)}</p>
                <h2 id={EDIT_TITLE_ID} tabIndex={-1}>{BLOCKS_COPY.types[openedBlock.input.type].label}</h2>
              </div>
              <button type="button" id={`${openedBlock.id}-delete`} className="studio-icon-button" data-tone="danger" aria-label={EDITOR_COPY.actions.deleteLabel(EDITOR_COPY.blockName(BLOCKS_COPY.types[openedBlock.input.type].label, openIndex + 1))} title={EDITOR_COPY.actions.delete} disabled={uploading} onClick={() => remove(openedBlock.id)}>
                <StudioIcon name="trash" />
              </button>
              <Button type="button" id={`${openedBlock.id}-done`} disabled={uploading} onClick={() => closeBlock(openedBlock.id)}>{EDITOR_COPY.actions.done}</Button>
            </div>
          )
        ) : (
          <div className="studio-panel-top">
            <div className="studio-tabs" role="group" aria-label={EDITOR_COPY.studio.tabsLabel}>
              {STUDIO_TABS.map((item) => (
                <button key={item} type="button" className="studio-tab" disabled={uploading} aria-pressed={tab === item} onClick={() => selectTab(item)}>{EDITOR_COPY.studio.tabs[item]}</button>
              ))}
            </div>
          </div>
        )}

        <div ref={scrollRef} className="studio-scroll">
          {!openedBlock && !headerOpen && !pickerOpen && tab !== "content" ? <p className="studio-mobile-lead">{EDITOR_COPY.studio.mobile[tab === "styles" ? "stylesLead" : "pageLead"]}</p> : null}
          {snapshot.status === "conflict" ? (
            <section className="grid gap-3 rounded-lg border border-app-danger/40 bg-app-danger/10 p-3" aria-labelledby="conflict-title">
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

          {openedBlock ? (
            pickerOpen ? picker : (
              <BlockEditView
                key={openedBlock.id}
                block={openedBlock}
                profileId={profileId}
                position={openIndex + 1}
                total={total}
                check={check.blocks[openedBlock.id]}
                showError={showErrorFor(openedBlock.id)}
                canAdd={canAdd}
                uploading={uploading}
                onEdit={(field, value) => apply({ type: "edit", id: openedBlock.id, field, value })}
                onEditSocial={(network, value) => apply({ type: "edit_social", id: openedBlock.id, network, value })}
                onSetInput={(input) => apply({ type: "set_input", id: openedBlock.id, input })}
                onUploadBusy={(busy) => setUploadBusy(openedBlock.id, busy)}
                onImageUploaded={(media) => imageUploaded(openedBlock.id, media)}
                onBlur={(field) => {
                  markTouched(`${openedBlock.id}:${field}`);
                  apply({ type: "normalize", id: openedBlock.id });
                }}
                onMove={(to) => move(openedBlock.id, to)}
                onDuplicate={() => duplicate(openedBlock.id)}
                onToggleVisible={() => toggleVisible(openedBlock.id)}
                onAddAfter={() => { setPickerOpen(true); focusLater("editor-add-first"); }}
              />
            )
          ) : tab === "content" ? (
            pickerOpen ? picker : headerOpen ? headerView : contentList
          ) : tab === "styles" ? (
            <AppearancePanel theme={state.theme} hasBlocks={total > 0} lastTemplate={state.lastTemplate} onSetTheme={setTheme} onApplyTemplate={applyTemplate} onUndoTemplate={undoTemplate} />
          ) : settings}
        </div>
      </section>

      <aside id="editor-preview" className="studio-stage" data-device={device} aria-labelledby="editor-preview-title">
        <div className="studio-preview-toolbar">
          <span>{EDITOR_COPY.studio.mobile.preview}</span>
          <button type="button" id="editor-preview-resume" className="studio-preview-resume" onClick={() => selectTab(tab)}><StudioIcon name="edit" size={18} />{EDITOR_COPY.studio.mobile.resume}</button>
        </div>
        <p className="studio-preview-hint">{EDITOR_COPY.studio.mobile.previewHint}</p>
        <h2 id="editor-preview-title" className="sr-only">{EDITOR_COPY.preview.title}</h2>
        <div className="studio-stage-tools" role="group" aria-label={EDITOR_COPY.studio.device.label}>
          <button type="button" className="studio-device" aria-pressed={device === "phone"} aria-label={EDITOR_COPY.studio.device.phone} title={EDITOR_COPY.studio.device.phone} onClick={() => setDevice("phone")}><StudioIcon name="phone" /></button>
          <button type="button" className="studio-device" aria-pressed={device === "desktop"} aria-label={EDITOR_COPY.studio.device.desktop} title={EDITOR_COPY.studio.device.desktop} onClick={() => setDevice("desktop")}><StudioIcon name="desktop" /></button>
        </div>
        <p className="studio-stage-note">{EDITOR_COPY.preview.banner}</p>
        <div className="studio-frame">
          <p className="studio-frame-bar m-0" aria-hidden="true">{addressHost}{addressPath.length > 0 ? <>/<b>{addressPath.join("/")}</b></> : null}</p>
          <div ref={previewRef} className="studio-frame-view" data-pick="" tabIndex={0} role="region" aria-label={EDITOR_COPY.preview.title} onClick={pickInPreview}>
            <PublicPageView as="div" document={preview} showBadge={showBadge} interactive={false} />
          </div>
        </div>
      </aside>

      <nav className="studio-mobile-nav" aria-label={EDITOR_COPY.studio.tabsLabel}>
        {STUDIO_TABS.map((item) => (
          <button key={item} type="button" disabled={uploading && (tab !== item || !mobilePreview)} aria-pressed={!mobilePreview && tab === item} aria-controls="editor-panel" onClick={() => selectTab(item)}>
            <StudioIcon name={item === "content" ? "templates" : item === "styles" ? "colors" : "pages"} size={22} />
            <span>{EDITOR_COPY.studio.tabs[item]}</span>
          </button>
        ))}
        <button type="button" aria-pressed={mobilePreview} aria-controls="editor-preview" onClick={showMobilePreview}>
          <StudioIcon name="preview" size={22} /><span>{EDITOR_COPY.studio.mobile.preview}</span>
        </button>
      </nav>

      <p aria-live="polite" className="sr-only"><span key={announcement.n}>{announcement.text}</span></p>

      {state.lastDeleted ? (
        <div className="studio-undo" onMouseEnter={() => setUndoPaused(true)} onMouseLeave={() => setUndoPaused(false)} onFocus={() => setUndoPaused(true)} onBlur={() => setUndoPaused(false)} onKeyDown={(event) => { if (event.key === "Escape") { apply({ type: "dismiss_undo" }); focusLater(focusAfterUndo.current); } }}>
          <span>{EDITOR_COPY.undo.deleted}</span>
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
