import type { Block, EditorAction, EditorState } from "./types";

export function cloneBlock<T extends Block>(block: T): T {
  return structuredClone(block);
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const blocks = state.document.blocks;
  const nextRevision = state.revision + 1;
  switch (action.type) {
    case "add": {
      const index = action.index ?? blocks.length;
      const next = [...blocks];
      next.splice(Math.max(0, Math.min(index, next.length)), 0, cloneBlock(action.block));
      return { document: { ...state.document, blocks: next }, revision: nextRevision };
    }
    case "update":
      return { document: { ...state.document, blocks: blocks.map((block) => block.id === action.block.id ? cloneBlock(action.block) : block) }, revision: nextRevision };
    case "move": {
      const from = blocks.findIndex((block) => block.id === action.blockId);
      if (from < 0) return state;
      const to = action.direction === "up" ? from - 1 : from + 1;
      if (to < 0 || to >= blocks.length) return state;
      const next = [...blocks];
      const [moving] = next.splice(from, 1);
      if (!moving) return state;
      next.splice(to, 0, moving);
      return { document: { ...state.document, blocks: next }, revision: nextRevision };
    }
    case "duplicate": {
      const index = blocks.findIndex((block) => block.id === action.blockId);
      if (index < 0) return state;
      const source = blocks[index];
      if (!source) return state;
      const duplicate = { ...cloneBlock(source), id: `${source.id}-copy-${nextRevision}` };
      const next = [...blocks];
      next.splice(index + 1, 0, duplicate);
      return { document: { ...state.document, blocks: next }, revision: nextRevision };
    }
    case "toggle":
      return { document: { ...state.document, blocks: blocks.map((block) => block.id === action.blockId ? { ...block, visible: !block.visible } : block) }, revision: nextRevision };
    case "delete": {
      const index = blocks.findIndex((block) => block.id === action.blockId);
      const deleted = blocks[index];
      if (index < 0 || !deleted) return state;
      return { document: { ...state.document, blocks: blocks.filter((block) => block.id !== action.blockId) }, revision: nextRevision, undoDelete: { block: cloneBlock(deleted), index } };
    }
    case "undo-delete": {
      if (!state.undoDelete) return state;
      const next = [...blocks];
      next.splice(state.undoDelete.index, 0, cloneBlock(state.undoDelete.block));
      return { document: { ...state.document, blocks: next }, revision: nextRevision };
    }
    case "replace-document":
      return { document: structuredClone(action.document), revision: nextRevision };
  }
}
