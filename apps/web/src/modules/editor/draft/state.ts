import { blockToInput, emptyBlockInput, MAX_BLOCKS, normalizedInput, validateBlockInput, validateStoredBlocks, type BlockFieldErrors, type BlockInput, type BlockNotices, type BlockType, type DraftBlock, type SocialNetwork } from "@/modules/blocks";
import { validateProfileContent, type ProfileContentField } from "@/modules/profiles/content";
import { applyTemplate } from "@/modules/themes/apply-template";
import { findTemplate, type TemplateId } from "@/modules/themes/templates";
import { cloneTheme, isValidTheme, themesEqual, type ThemeTokens } from "@/modules/themes/tokens";

/**
 * Editor state for the block editor (ADR 0008, extended by ADR 0010). Framework-free: React
 * components dispatch these actions and render the result. Blocks keep what the person typed
 * (`input`); the stored draft is derived by validation, so an invalid field is never saved and
 * never silently "fixed". Theme and avatar are part of the same draft and the same save.
 */
export interface EditorBlock {
  id: string;
  visible: boolean;
  input: BlockInput;
}

export interface DeletedBlock {
  block: EditorBlock;
  index: number;
}

/** What "Desfazer" restores after a template was applied. */
export interface AppliedTemplate {
  templateId: TemplateId;
  previousTheme: ThemeTokens | null;
  /** Example blocks the template added (none when the page already had content). */
  exampleIds: string[];
}

export interface EditorState {
  title: string;
  bio: string;
  /** Media id of the avatar, or null for the initials. */
  avatarPath: string | null;
  /** `null` is the classic look. */
  theme: ThemeTokens | null;
  blocks: EditorBlock[];
  /** Only the most recent deletion can be undone (UX-026). */
  lastDeleted: DeletedBlock | null;
  /** Only the most recent template can be undone. */
  lastTemplate: AppliedTemplate | null;
}

export interface DraftContentLike {
  title: string;
  bio: string;
  avatarPath: string | null;
  theme: ThemeTokens | null;
  blocks: readonly DraftBlock[];
}

export type TextBlockField = "title" | "url" | "text" | "label" | "phone" | "message" | "alt" | "key" | "paymentUrl" | "buttonLabel" | "consentText";
export type MoveTarget = "up" | "down" | "top" | "bottom";

export type EditorAction =
  | { type: "set_header"; field: ProfileContentField; value: string }
  | { type: "set_avatar"; mediaId: string | null }
  | { type: "set_theme"; theme: ThemeTokens | null }
  | { type: "apply_template"; templateId: TemplateId; withExamples: boolean; ids: readonly string[] }
  | { type: "undo_template" }
  | { type: "dismiss_template_undo" }
  | { type: "add"; blockType: BlockType; id: string; afterId: string | null }
  | { type: "edit"; id: string; field: TextBlockField; value: string }
  | { type: "edit_social"; id: string; network: SocialNetwork; value: string }
  /** Replaces the form values of a block (choices, switches, an uploaded image). Same type only. */
  | { type: "set_input"; id: string; input: BlockInput }
  | { type: "normalize"; id: string }
  | { type: "move"; id: string; to: MoveTarget }
  | { type: "duplicate"; id: string; newId: string }
  | { type: "toggle_visible"; id: string }
  | { type: "delete"; id: string }
  | { type: "undo_delete" }
  | { type: "dismiss_undo" }
  | { type: "replace"; draft: DraftContentLike };

/** Actions that change structure save immediately; typing is debounced (ADR 0008). */
export function isStructuralAction(action: EditorAction): boolean {
  switch (action.type) {
    case "add":
    case "move":
    case "duplicate":
    case "toggle_visible":
    case "delete":
    case "undo_delete":
    case "set_avatar":
    case "set_input":
    case "apply_template":
    case "undo_template":
      return true;
    default:
      return false;
  }
}

/** Actions that only change what the editor shows, never what is stored. */
export function isViewOnlyAction(action: EditorAction): boolean {
  return action.type === "dismiss_undo" || action.type === "dismiss_template_undo";
}

export function editorStateFromDraft(draft: DraftContentLike): EditorState {
  return {
    title: draft.title,
    bio: draft.bio,
    avatarPath: draft.avatarPath,
    theme: draft.theme ? cloneTheme(draft.theme) : null,
    blocks: draft.blocks.map((block) => ({ id: block.id, visible: block.visible, input: blockToInput(block) })),
    lastDeleted: null,
    lastTemplate: null,
  };
}

function withBlocks(state: EditorState, blocks: EditorBlock[]): EditorState {
  return { ...state, blocks };
}

function editField(input: BlockInput, field: TextBlockField, value: string): BlockInput | null {
  switch (input.type) {
    case "link": return field === "title" || field === "url" ? { ...input, [field]: value } : null;
    case "text": return field === "text" ? { ...input, text: value } : null;
    case "whatsapp": return field === "label" || field === "phone" || field === "message" ? { ...input, [field]: value } : null;
    case "image": return field === "alt" ? { ...input, alt: value } : null;
    case "embed": return field === "title" || field === "url" ? { ...input, [field]: value } : null;
    case "pix": return field === "label" || field === "key" || field === "paymentUrl" ? { ...input, [field]: value } : null;
    case "form": return field === "title" || field === "buttonLabel" || field === "consentText" ? { ...input, [field]: value } : null;
    case "social":
    case "divider":
      return null;
  }
}

function moveIndex(from: number, to: MoveTarget, length: number): number {
  switch (to) {
    case "up": return Math.max(0, from - 1);
    case "down": return Math.min(length - 1, from + 1);
    case "top": return 0;
    case "bottom": return length - 1;
  }
}

/** Returns the same object when nothing changes, so callers can skip saving. */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { blocks } = state;
  const indexOf = (id: string) => blocks.findIndex((block) => block.id === id);

  switch (action.type) {
    case "set_header":
      return state[action.field] === action.value ? state : { ...state, [action.field]: action.value };

    case "set_avatar":
      return state.avatarPath === action.mediaId ? state : { ...state, avatarPath: action.mediaId };

    case "set_theme": {
      if (action.theme !== null && !isValidTheme(action.theme)) return state;
      return themesEqual(state.theme, action.theme) ? state : { ...state, theme: action.theme ? cloneTheme(action.theme) : null };
    }

    case "apply_template": {
      const template = findTemplate(action.templateId);
      if (!template) return state;
      const ids = [...action.ids];
      const applied = applyTemplate(state, template, { withExamples: action.withExamples, newId: () => ids.shift() ?? "" });
      // A missing or repeated id would corrupt the list: refuse rather than guess.
      const added = applied.blocks === state.blocks ? [] : applied.blocks.map((block) => block.id);
      if (added.some((id) => id === "") || new Set(added).size !== added.length) return state;
      return { ...applied, blocks: [...applied.blocks], lastTemplate: { templateId: template.id, previousTheme: state.theme, exampleIds: added } };
    }

    case "undo_template": {
      const applied = state.lastTemplate;
      if (!applied) return state;
      const examples = new Set(applied.exampleIds);
      return { ...state, theme: applied.previousTheme, blocks: examples.size > 0 ? blocks.filter((block) => !examples.has(block.id)) : blocks, lastTemplate: null };
    }

    case "dismiss_template_undo":
      return state.lastTemplate ? { ...state, lastTemplate: null } : state;

    case "add": {
      if (blocks.length >= MAX_BLOCKS || indexOf(action.id) >= 0) return state;
      const after = action.afterId === null ? -1 : indexOf(action.afterId);
      const position = after >= 0 ? after + 1 : blocks.length;
      const next = [...blocks];
      next.splice(position, 0, { id: action.id, visible: true, input: emptyBlockInput(action.blockType) });
      return withBlocks(state, next);
    }

    case "edit": {
      const index = indexOf(action.id);
      const block = blocks[index];
      if (!block) return state;
      const input = editField(block.input, action.field, action.value);
      if (!input) return state;
      return withBlocks(state, blocks.map((item, position) => (position === index ? { ...item, input } : item)));
    }

    case "edit_social": {
      const index = indexOf(action.id);
      const block = blocks[index];
      if (!block || block.input.type !== "social") return state;
      const input: BlockInput = { type: "social", items: { ...block.input.items, [action.network]: action.value } };
      return withBlocks(state, blocks.map((item, position) => (position === index ? { ...item, input } : item)));
    }

    case "set_input": {
      const index = indexOf(action.id);
      const block = blocks[index];
      if (!block || block.input.type !== action.input.type) return state;
      if (JSON.stringify(block.input) === JSON.stringify(action.input)) return state;
      const input = structuredClone(action.input);
      return withBlocks(state, blocks.map((item, position) => (position === index ? { ...item, input } : item)));
    }

    case "normalize": {
      const index = indexOf(action.id);
      const block = blocks[index];
      if (!block) return state;
      const input = normalizedInput(block.input);
      if (JSON.stringify(input) === JSON.stringify(block.input)) return state;
      return withBlocks(state, blocks.map((item, position) => (position === index ? { ...item, input } : item)));
    }

    case "move": {
      const from = indexOf(action.id);
      if (from < 0) return state;
      const to = moveIndex(from, action.to, blocks.length);
      if (to === from) return state;
      const next = [...blocks];
      const [moving] = next.splice(from, 1);
      if (!moving) return state;
      next.splice(to, 0, moving);
      return withBlocks(state, next);
    }

    case "duplicate": {
      const index = indexOf(action.id);
      const source = blocks[index];
      if (!source || blocks.length >= MAX_BLOCKS || indexOf(action.newId) >= 0) return state;
      const next = [...blocks];
      next.splice(index + 1, 0, { id: action.newId, visible: source.visible, input: structuredClone(source.input) });
      return withBlocks(state, next);
    }

    case "toggle_visible": {
      const index = indexOf(action.id);
      if (index < 0) return state;
      return withBlocks(state, blocks.map((item, position) => (position === index ? { ...item, visible: !item.visible } : item)));
    }

    case "delete": {
      const index = indexOf(action.id);
      const block = blocks[index];
      if (!block) return state;
      return { ...state, blocks: blocks.filter((item) => item.id !== action.id), lastDeleted: { block, index } };
    }

    case "undo_delete": {
      const deleted = state.lastDeleted;
      if (!deleted) return state;
      if (indexOf(deleted.block.id) >= 0 || blocks.length >= MAX_BLOCKS) return { ...state, lastDeleted: null };
      const next = [...blocks];
      // Other edits may have happened meanwhile: restore at the same position, or at the end.
      next.splice(Math.min(deleted.index, next.length), 0, deleted.block);
      return { ...state, blocks: next, lastDeleted: null };
    }

    case "dismiss_undo":
      return state.lastDeleted ? { ...state, lastDeleted: null } : state;

    case "replace":
      return editorStateFromDraft(action.draft);
  }
}

export interface BlockCheck {
  errors: BlockFieldErrors;
  notices: BlockNotices;
  valid: boolean;
}

export interface CheckedDraft {
  title: string;
  bio: string;
  avatarPath: string | null;
  theme: ThemeTokens | null;
  blocks: DraftBlock[];
}

export type DraftCheck =
  | { ok: true; draft: CheckedDraft; blocks: Record<string, BlockCheck> }
  | { ok: false; header: Partial<Record<ProfileContentField, string>>; blocks: Record<string, BlockCheck>; limit: "too_many" | "too_large" | null };

/**
 * Derives the draft that would be saved. Invalid fields block saving (status "invalid") and are
 * reported per block; the caps are checked with the same function the server uses.
 */
export function checkDraft(state: EditorState): DraftCheck {
  const header = validateProfileContent({ title: state.title, bio: state.bio });
  const checks: Record<string, BlockCheck> = {};
  const valid: DraftBlock[] = [];
  for (const block of state.blocks) {
    const result = validateBlockInput(block.id, block.visible, block.input);
    checks[block.id] = result.ok ? { errors: {}, notices: result.notices, valid: true } : { errors: result.errors, notices: {}, valid: false };
    if (result.ok) valid.push(result.block);
  }
  const headerErrors = header.ok ? {} : header.errors;
  if (!header.ok || valid.length !== state.blocks.length) return { ok: false, header: headerErrors, blocks: checks, limit: null };
  const stored = validateStoredBlocks(valid);
  if (!stored.ok) return { ok: false, header: headerErrors, blocks: checks, limit: stored.reason === "too_many" ? "too_many" : "too_large" };
  return { ok: true, draft: { title: header.value.title, bio: header.value.bio, avatarPath: state.avatarPath, theme: state.theme, blocks: stored.blocks }, blocks: checks };
}

/**
 * What the preview shows right now: the header as typed and every block that is currently valid
 * (an invalid block is left out until it is fixed, exactly as it could never be published).
 */
export function previewDraft(state: EditorState): DraftContentLike {
  const blocks: DraftBlock[] = [];
  for (const block of state.blocks) {
    const result = validateBlockInput(block.id, block.visible, block.input);
    if (result.ok) blocks.push(result.block);
  }
  return { title: state.title.trim(), bio: state.bio.trim(), avatarPath: state.avatarPath, theme: state.theme, blocks };
}
