import { MAX_BLOCKS, type BlockInput } from "@/modules/blocks";
import type { TemplateDefinition } from "./templates";
import { cloneTheme, type ThemeTokens } from "./tokens";

export interface ExampleBlock {
  id: string;
  visible: boolean;
  input: BlockInput;
}

/** The part of a page a template can touch: its theme and, only when empty, its blocks. */
export interface TemplateTarget {
  theme: ThemeTokens | null;
  blocks: readonly ExampleBlock[];
}

export interface ApplyTemplateOptions {
  /** The person asked for the example blocks. Honored only when the page has no blocks at all. */
  withExamples: boolean;
  /** One fresh id per example block. */
  newId: () => string;
}

/**
 * Applies a template without losing content (ADR 0010, AC3). Presentation changes; everything else
 * the caller passes in (title, bio, avatar, address, blocks with their order and visibility) comes
 * back untouched, by reference. Example blocks are added only to a page with no blocks, and only
 * on request.
 */
export function applyTemplate<Page extends TemplateTarget>(page: Page, template: TemplateDefinition, options: ApplyTemplateOptions): Page {
  const theme = cloneTheme(template.theme);
  if (!options.withExamples || page.blocks.length > 0) return { ...page, theme };
  const examples: ExampleBlock[] = template.examples.slice(0, MAX_BLOCKS).map((input) => ({ id: options.newId(), visible: true, input: structuredClone(input) }));
  return { ...page, theme, blocks: examples };
}
