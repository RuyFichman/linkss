import { blockToInput, emptyBlockInput, MAX_BLOCKS, normalizedInput, validateBlockInput, validateStoredBlocks, type BlockFieldErrors, type BlockInput, type BlockNotices, type BlockType, type DraftBlock, type SocialNetwork } from "@/modules/blocks";
import { validateProfileContent, type ProfileContentField } from "@/modules/profiles/content";

/**
 * Editor state for the block editor (ADR 0008). Framework-free: React components dispatch these
 * actions and render the result. Blocks keep what the person typed (`input`); the stored draft is
 * derived by validation, so an invalid field is never saved and never silently "fixed".
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

export interface EditorState {
  title: string;
  bio: string;
  blocks: EditorBlock[];
  /** Only the most recent deletion can be undone (UX-026). */
  lastDeleted: DeletedBlock | null;
}

export interface DraftContentLike {
  title: string;
  bio: string;
  blocks: readonly DraftBlock[];
}

export type TextBlockField = "title" | "url" | "text" | "label" | "phone" | "message";
export type MoveTarget = "up" | "down" | "top" | "bottom";

export type EditorAction =
  | { type: "set_header"; field: ProfileContentField; value: string }
  | { type: "add"; blockType: BlockType; id: string; afterId: string | null }
  | { type: "edit"; id: string; field: TextBlockField; value: string }
  | { type: "edit_social"; id: string; network: SocialNetwork; value: string }
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
  return action.type === "add" || action.type === "move" || action.type === "duplicate" || action.type === "toggle_visible" || action.type === "delete" || action.type === "undo_delete";
}

export function editorStateFromDraft(draft: DraftContentLike): EditorState {
  return { title: draft.title, bio: draft.bio, blocks: draft.blocks.map((block) => ({ id: block.id, visible: block.visible, input: blockToInput(block) })), lastDeleted: null };
}

function withBlocks(state: EditorState, blocks: EditorBlock[]): EditorState {
  return { ...state, blocks };
}

function editField(input: BlockInput, field: TextBlockField, value: string): BlockInput | null {
  switch (input.type) {
    case "link": return field === "title" || field === "url" ? { ...input, [field]: value } : null;
    case "text": return field === "text" ? { ...input, text: value } : null;
    case "whatsapp": return field === "label" || field === "phone" || field === "message" ? { ...input, [field]: value } : null;
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

export type DraftCheck =
  | { ok: true; draft: { title: string; bio: string; blocks: DraftBlock[] }; blocks: Record<string, BlockCheck> }
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
  return { ok: true, draft: { title: header.value.title, bio: header.value.bio, blocks: stored.blocks }, blocks: checks };
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
  return { title: state.title.trim(), bio: state.bio.trim(), blocks };
}
