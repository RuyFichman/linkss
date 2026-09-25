import type { PageDocument, TemplateDefinition } from "./types";

export function applyTemplate(document: PageDocument, template: TemplateDefinition): PageDocument {
  return {
    ...structuredClone(document),
    theme: structuredClone(template.theme),
    blocks: document.blocks.length === 0 ? structuredClone(template.seedBlocks) : structuredClone(document.blocks),
    status: document.status === "published" ? "pending" : document.status,
  };
}

export function duplicatePage(source: PageDocument, id: string, slug: string, title = `${source.title} — cópia`): PageDocument {
  const copy = structuredClone(source);
  return { ...copy, id, slug, title, status: "draft", publishedAt: undefined };
}

export function hasVisibleBlock(document: PageDocument): boolean { return document.blocks.some((block) => block.visible); }
export function hasValueAction(document: PageDocument): boolean { return document.blocks.some((block) => block.visible && block.valueAction); }
