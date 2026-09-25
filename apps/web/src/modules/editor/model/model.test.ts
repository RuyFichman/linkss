import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../templates";
import { applyTemplate, buildWhatsAppUrl, duplicatePage, editorReducer, normalizeUrl, validateSlug, type EditorState, type PageDocument } from ".";

const base: PageDocument = { id: "p1", workspaceId: "w1", title: "Página teste", bio: "Bio", slug: "pagina-teste", status: "draft", plan: "free", theme: structuredClone(TEMPLATES[0].theme), blocks: [{ id: "a", type: "text", text: "Olá", visible: true, valueAction: false }, { id: "b", type: "link", title: "Agenda", url: "agenda.test", visible: true, valueAction: true }] };
const state = (): EditorState => ({ document: structuredClone(base), revision: 0 });

describe("editor reducer", () => {
  it("adds and updates blocks", () => { const added = editorReducer(state(), { type: "add", block: { id: "c", type: "separator", style: "line", visible: true, valueAction: false } }); expect(added.document.blocks).toHaveLength(3); const changed = { ...added.document.blocks[0]!, type: "text" as const, text: "Novo" }; expect(editorReducer(added, { type: "update", block: changed }).document.blocks[0]).toMatchObject({ text: "Novo" }); });
  it("moves in both directions", () => { const down = editorReducer(state(), { type: "move", blockId: "a", direction: "down" }); expect(down.document.blocks.map((b) => b.id)).toEqual(["b", "a"]); expect(editorReducer(down, { type: "move", blockId: "a", direction: "up" }).document.blocks.map((b) => b.id)).toEqual(["a", "b"]); });
  it("duplicates without sharing references and toggles visibility", () => { const duplicated = editorReducer(state(), { type: "duplicate", blockId: "b" }); expect(duplicated.document.blocks).toHaveLength(3); expect(duplicated.document.blocks[2]).not.toBe(duplicated.document.blocks[1]); expect(editorReducer(duplicated, { type: "toggle", blockId: "b" }).document.blocks[1]?.visible).toBe(false); });
  it("deletes and undoes deletion", () => { const deleted = editorReducer(state(), { type: "delete", blockId: "a" }); expect(deleted.document.blocks.map((b) => b.id)).toEqual(["b"]); expect(editorReducer(deleted, { type: "undo-delete" }).document.blocks.map((b) => b.id)).toEqual(["a", "b"]); });
});

describe("URL rules", () => {
  it("adds https and blocks dangerous schemes", () => { expect(normalizeUrl("example.com")).toEqual({ ok: true, url: "https://example.com/" }); for (const value of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd"]) expect(normalizeUrl(value).ok).toBe(false); });
  it("builds Brazilian WhatsApp links and encodes messages", () => { expect(buildWhatsAppUrl("(11) 99999-0000")).toMatchObject({ ok: true, phone: "5511999990000" }); const result = buildWhatsAppUrl("+55 21 98888-0000", "Olá & tudo bem?"); expect(result.ok && result.url).toContain("text=Ol%C3%A1+%26+tudo+bem%3F"); });
});

describe("slug rules", () => {
  it("normalizes accents and spaces", () => expect(validateSlug("  Café da Júlia ").normalized).toBe("cafe-da-julia"));
  it("covers reserved, taken, length and characters", () => { expect(validateSlug("admin").status).toBe("reserved"); expect(validateSlug("cafe-ipe", ["cafe-ipe"]).status).toBe("taken"); expect(validateSlug("ab").status).toBe("too-short"); expect(validateSlug("a".repeat(41)).status).toBe("too-long"); expect(validateSlug("cafe@ipe").status).toBe("invalid"); expect(validateSlug("cafe-ipe").status).toBe("available"); });
});

describe("templates and duplication", () => {
  it("has five unique valid templates with value actions", () => { expect(TEMPLATES).toHaveLength(5); expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(5); for (const template of TEMPLATES) { expect(template.seedBlocks.some((block) => block.valueAction)).toBe(true); expect(template.theme.pageBg).toMatch(/^#[0-9A-F]{6}$/i); } });
  it("applies a template without losing existing blocks", () => { const applied = applyTemplate(base, TEMPLATES[1]); expect(applied.blocks).toEqual(base.blocks); expect(applied.theme.id).toBe(TEMPLATES[1].theme.id); });
  it("seeds an empty page and duplicates with a deep copy", () => { const empty = { ...base, blocks: [] }; expect(applyTemplate(empty, TEMPLATES[2]).blocks.length).toBeGreaterThan(0); const duplicate = duplicatePage(base, "p2", "copia"); expect(duplicate.status).toBe("draft"); expect(duplicate.blocks).not.toBe(base.blocks); expect(duplicate.blocks[0]).not.toBe(base.blocks[0]); });
});
