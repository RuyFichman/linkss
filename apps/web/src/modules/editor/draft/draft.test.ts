import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BLOCKS, type DraftBlock } from "@/modules/blocks";
import { buildDocumentJson, documentFromDraft } from "@/modules/publishing/document";
import { createAutosave, type SaveOutcome } from "./autosave";
import { checkDraft, editorReducer, editorStateFromDraft, isStructuralAction, previewDraft, type EditorAction, type EditorState } from "./state";

const id = (n: number) => `6f1c1d2e-0000-4000-8000-${String(n).padStart(12, "0")}`;

function link(n: number, visible = true): DraftBlock {
  return { id: id(n), type: "link", visible, title: `Link ${n}`, url: `https://exemplo${n}.com.br/` };
}

function state(blocks: DraftBlock[] = [link(1), link(2), link(3)]): EditorState {
  return editorStateFromDraft({ title: "Café Ipê", bio: "", blocks });
}

function run(initial: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, initial);
}

const order = (value: EditorState) => value.blocks.map((block) => block.id);

describe("editor reducer", () => {
  it("adds after the open block, or at the end, with an empty form", () => {
    const afterFirst = run(state(), { type: "add", blockType: "whatsapp", id: id(9), afterId: id(1) });
    expect(order(afterFirst)).toEqual([id(1), id(9), id(2), id(3)]);
    expect(afterFirst.blocks[1]).toEqual({ id: id(9), visible: true, input: { type: "whatsapp", label: "", phone: "", message: "" } });
    expect(order(run(state(), { type: "add", blockType: "divider", id: id(9), afterId: null }))).toEqual([id(1), id(2), id(3), id(9)]);
    expect(order(run(state([]), { type: "add", blockType: "text", id: id(9), afterId: "gone" }))).toEqual([id(9)]);
  });

  it("moves up, down, to the top and to the bottom, and ignores moves past the edges", () => {
    const initial = state();
    expect(order(run(initial, { type: "move", id: id(3), to: "up" }))).toEqual([id(1), id(3), id(2)]);
    expect(order(run(initial, { type: "move", id: id(1), to: "down" }))).toEqual([id(2), id(1), id(3)]);
    expect(order(run(initial, { type: "move", id: id(3), to: "top" }))).toEqual([id(3), id(1), id(2)]);
    expect(order(run(initial, { type: "move", id: id(1), to: "bottom" }))).toEqual([id(2), id(3), id(1)]);
    expect(run(initial, { type: "move", id: id(1), to: "up" })).toBe(initial);
    expect(run(initial, { type: "move", id: id(3), to: "down" })).toBe(initial);
    expect(run(initial, { type: "move", id: "missing", to: "down" })).toBe(initial);
  });

  it("duplicates right after the original with a new id and an independent copy", () => {
    const duplicated = run(state([link(1, false), link(2)]), { type: "duplicate", id: id(1), newId: id(7) });
    expect(order(duplicated)).toEqual([id(1), id(7), id(2)]);
    expect(duplicated.blocks[1]).toMatchObject({ visible: false, input: duplicated.blocks[0]?.input });
    const edited = editorReducer(duplicated, { type: "edit", id: id(7), field: "title", value: "Cópia" });
    expect(edited.blocks[0]?.input).toMatchObject({ title: "Link 1" });
    expect(run(duplicated, { type: "duplicate", id: id(1), newId: id(2) })).toBe(duplicated);
  });

  it("toggles visibility without moving the block", () => {
    const hidden = run(state(), { type: "toggle_visible", id: id(2) });
    expect(hidden.blocks.map((block) => block.visible)).toEqual([true, false, true]);
    expect(run(hidden, { type: "toggle_visible", id: id(2) }).blocks[1]?.visible).toBe(true);
  });

  it("deletes and undoes at the original position, even after other edits", () => {
    const deleted = run(state(), { type: "delete", id: id(2) });
    expect(order(deleted)).toEqual([id(1), id(3)]);
    expect(order(run(deleted, { type: "undo_delete" }))).toEqual([id(1), id(2), id(3)]);
    const afterEdits = run(deleted, { type: "edit", id: id(1), field: "title", value: "Novo" }, { type: "delete", id: id(1) });
    // Only the latest deletion can be undone.
    expect(order(run(afterEdits, { type: "undo_delete" }))).toEqual([id(1), id(3)]);
    const shrunk = run(state(), { type: "delete", id: id(3) }, { type: "undo_delete" }, { type: "delete", id: id(3) });
    expect(order(run({ ...shrunk, blocks: [] }, { type: "undo_delete" }))).toEqual([id(3)]);
    expect(run(deleted, { type: "dismiss_undo" }).lastDeleted).toBeNull();
    const noUndo = run(deleted, { type: "dismiss_undo" });
    expect(run(noUndo, { type: "undo_delete" })).toBe(noUndo);
  });

  it("edits only fields that belong to the block type", () => {
    const initial = state([link(1), { id: id(2), type: "social", visible: true, items: [] }]);
    expect(run(initial, { type: "edit", id: id(1), field: "phone", value: "11" })).toBe(initial);
    expect(run(initial, { type: "edit_social", id: id(1), network: "x", value: "@a" })).toBe(initial);
    expect(run(initial, { type: "edit_social", id: id(2), network: "x", value: "@ana" }).blocks[1]?.input).toEqual({ type: "social", items: { x: "@ana" } });
    expect(run(initial, { type: "set_header", field: "title", value: "Café Ipê" })).toBe(initial);
  });

  it("normalizes a block when the field loses focus", () => {
    const typed = run(state([]), { type: "add", blockType: "link", id: id(1), afterId: null }, { type: "edit", id: id(1), field: "url", value: "exemplo.com.br" });
    const normalized = editorReducer(typed, { type: "normalize", id: id(1) });
    expect(normalized.blocks[0]?.input).toMatchObject({ url: "https://exemplo.com.br/" });
    expect(editorReducer(normalized, { type: "normalize", id: id(1) })).toBe(normalized);
  });

  it("caps blocks at the technical limit", () => {
    const full = state(Array.from({ length: MAX_BLOCKS }, (_, index) => link(index + 1)));
    expect(run(full, { type: "add", blockType: "divider", id: id(500), afterId: null })).toBe(full);
    expect(run(full, { type: "duplicate", id: id(1), newId: id(500) })).toBe(full);
  });

  it("treats structural actions as immediate saves and typing as debounced", () => {
    expect(isStructuralAction({ type: "move", id: "a", to: "up" })).toBe(true);
    expect(isStructuralAction({ type: "undo_delete" })).toBe(true);
    expect(isStructuralAction({ type: "edit", id: "a", field: "title", value: "" })).toBe(false);
  });
});

describe("draft check and preview", () => {
  it("derives the stored draft only when every block is valid", () => {
    const initial = state();
    expect(checkDraft(initial)).toMatchObject({ ok: true, draft: { title: "Café Ipê", blocks: [link(1), link(2), link(3)] } });
    const broken = run(initial, { type: "edit", id: id(2), field: "url", value: "javascript:alert(1)" });
    const check = checkDraft(broken);
    expect(check.ok).toBe(false);
    expect(check.blocks[id(2)]?.errors.url).toContain("não é permitido");
    expect(check.blocks[id(1)]?.valid).toBe(true);
    expect(checkDraft(run(initial, { type: "set_header", field: "title", value: " " }))).toMatchObject({ ok: false, header: { title: expect.any(String) } });
  });

  it("flags a pre-Sprint-4 link the stricter policy refuses instead of dropping it", () => {
    const legacy = state([{ id: id(1), type: "link", visible: true, title: "Intranet", url: "https://intranet/" }]);
    expect(legacy.blocks).toHaveLength(1);
    expect(checkDraft(legacy).ok).toBe(false);
  });

  it("previews valid blocks immediately and leaves invalid ones out", () => {
    const typing = run(state([link(1)]), { type: "add", blockType: "text", id: id(2), afterId: null });
    expect(previewDraft(typing).blocks.map((block) => block.id)).toEqual([id(1)]);
    const typed = editorReducer(typing, { type: "edit", id: id(2), field: "text", value: "Olá" });
    expect(previewDraft(typed).blocks.map((block) => block.id)).toEqual([id(1), id(2)]);
  });

  it("editor, preview and snapshot share one order (AC1)", () => {
    const edited = run(state([link(1), link(2), link(3, false)]),
      { type: "move", id: id(3), to: "top" },
      { type: "duplicate", id: id(1), newId: id(4) },
      { type: "delete", id: id(2) },
      { type: "toggle_visible", id: id(3) });
    const check = checkDraft(edited);
    if (!check.ok) throw new Error("draft should be valid");
    const editorOrder = order(edited);
    expect(editorOrder).toEqual([id(3), id(1), id(4)]);
    expect(check.draft.blocks.map((block) => block.id)).toEqual(editorOrder);
    expect(documentFromDraft({ ...previewDraft(edited), avatarPath: null }).blocks.map((block) => block.id)).toEqual(editorOrder);
    expect(buildDocumentJson({ ...check.draft, avatarPath: null }).blocks.map((block) => block.id)).toEqual(editorOrder);
  });
});

describe("autosave status machine", () => {
  type Draft = { n: number };
  let pending: Array<{ draft: Draft; revision: number; resolve: (outcome: SaveOutcome) => void; reject: (error: Error) => void }>;

  beforeEach(() => {
    vi.useFakeTimers();
    pending = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function controller() {
    const save = vi.fn((draft: Draft, revision: number) => new Promise<SaveOutcome>((resolve, reject) => pending.push({ draft, revision, resolve, reject })));
    return { autosave: createAutosave<Draft>({ revision: 5, save }), save };
  }

  async function settle(outcome: SaveOutcome | Error) {
    const call = pending.shift();
    if (!call) throw new Error("no save in flight");
    if (outcome instanceof Error) call.reject(outcome);
    else call.resolve(outcome);
    await vi.advanceTimersByTimeAsync(0);
  }

  it("debounces typing, then shows Salvo only after the server confirms", async () => {
    const { autosave, save } = controller();
    expect(autosave.getSnapshot().status).toBe("saved");
    autosave.update({ n: 1 }, { immediate: false });
    autosave.update({ n: 2 }, { immediate: false });
    expect(autosave.getSnapshot().status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith({ n: 2 }, 5);
    expect(autosave.getSnapshot().status).toBe("saving");
    await settle({ ok: true, revision: 6 });
    expect(autosave.getSnapshot()).toEqual({ status: "saved", revision: 6, failure: null });
  });

  it("saves structural changes immediately and never overlaps saves", async () => {
    const { autosave, save } = controller();
    autosave.update({ n: 1 }, { immediate: true });
    autosave.update({ n: 2 }, { immediate: true });
    autosave.update({ n: 3 }, { immediate: true });
    expect(save).toHaveBeenCalledTimes(1);
    await settle({ ok: true, revision: 6 });
    // Only the latest pending state is sent next, against the confirmed revision.
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ n: 3 }, 6);
    expect(autosave.getSnapshot().status).toBe("saving");
    await settle({ ok: true, revision: 7 });
    expect(autosave.getSnapshot().status).toBe("saved");
  });

  it("an edit during a save keeps the status unsaved when the older save returns", async () => {
    const { autosave } = controller();
    autosave.update({ n: 1 }, { immediate: true });
    autosave.update({ n: 2 }, { immediate: false });
    await settle({ ok: true, revision: 6 });
    expect(autosave.getSnapshot().status).toBe("dirty");
    expect(autosave.hasUnsavedChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await settle({ ok: true, revision: 7 });
    expect(autosave.getSnapshot().status).toBe("saved");
  });

  it("retries network failures with backoff, then stops at error until the person retries", async () => {
    const { autosave, save } = controller();
    autosave.update({ n: 1 }, { immediate: true });
    await settle(new Error("Failed to fetch"));
    expect(autosave.getSnapshot()).toMatchObject({ status: "retrying", failure: "network" });
    await vi.advanceTimersByTimeAsync(1000);
    await settle({ ok: false, error: "unavailable" });
    await vi.advanceTimersByTimeAsync(2000);
    await settle(new Error("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(4000);
    await settle(new Error("Failed to fetch"));
    expect(save).toHaveBeenCalledTimes(4);
    expect(autosave.getSnapshot()).toEqual({ status: "error", revision: 5, failure: "network" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(4);
    autosave.flush();
    expect(autosave.getSnapshot().status).toBe("saving");
    await settle({ ok: true, revision: 6 });
    expect(autosave.getSnapshot().status).toBe("saved");
  });

  it("does not retry validation, permission or session failures", async () => {
    for (const error of ["validation", "forbidden", "not_found", "unauthenticated"] as const) {
      pending = [];
      const { autosave, save } = controller();
      autosave.update({ n: 1 }, { immediate: true });
      await settle({ ok: false, error });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(save).toHaveBeenCalledTimes(1);
      expect(autosave.getSnapshot()).toMatchObject({ status: "error", failure: error });
      expect(autosave.hasUnsavedChanges()).toBe(true);
    }
  });

  it("stops on a conflict, keeps local edits, and resolves either way", async () => {
    const { autosave, save } = controller();
    autosave.update({ n: 1 }, { immediate: true });
    await settle({ ok: false, error: "conflict" });
    expect(autosave.getSnapshot().status).toBe("conflict");
    autosave.update({ n: 2 }, { immediate: true });
    autosave.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.getSnapshot().status).toBe("conflict");

    autosave.keepMine(9);
    expect(save).toHaveBeenLastCalledWith({ n: 2 }, 9);
    await settle({ ok: true, revision: 10 });
    expect(autosave.getSnapshot()).toMatchObject({ status: "saved", revision: 10 });

    autosave.update({ n: 3 }, { immediate: true });
    await settle({ ok: false, error: "conflict" });
    autosave.reset(12);
    expect(autosave.getSnapshot()).toEqual({ status: "saved", revision: 12, failure: null });
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("never sends an invalid state and reports it as unsaved", async () => {
    const { autosave, save } = controller();
    autosave.update({ n: 1 }, { immediate: false });
    autosave.markInvalid();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.getSnapshot().status).toBe("invalid");
    autosave.update({ n: 2 }, { immediate: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenLastCalledWith({ n: 2 }, 5);
  });

  it("notifies subscribers only when the snapshot changes", async () => {
    const { autosave } = controller();
    const listener = vi.fn();
    autosave.subscribe(listener);
    autosave.update({ n: 1 }, { immediate: false });
    autosave.update({ n: 2 }, { immediate: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
