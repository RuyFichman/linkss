import { BLOCKS_COPY } from "@/content/pt-BR";
import type { DraftBlock } from "@/modules/blocks/model";
import type { AnalyticsEventType } from "./contract";

const TITLE_MAX = 60;

function shorten(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1)}…` : flat;
}

/** Name of a block in the ranking: the text the owner wrote on it, or the block type. */
export function blockTitle(block: DraftBlock): string {
  const typeLabel = BLOCKS_COPY.types[block.type].label;
  switch (block.type) {
    case "link": return shorten(block.title) || typeLabel;
    case "whatsapp": return shorten(block.label) || typeLabel;
    case "pix": return shorten(block.label) || typeLabel;
    case "form": return shorten(block.title) || typeLabel;
    case "embed": return shorten(block.title) || typeLabel;
    default: return typeLabel;
  }
}

/** Type name for a block that is no longer in the draft, from the kind of event it received. */
export function blockTypeLabelForEvent(type: AnalyticsEventType): string {
  switch (type) {
    case "link_click": return BLOCKS_COPY.types.link.label;
    case "social_click": return BLOCKS_COPY.types.social.label;
    case "embed_load": return BLOCKS_COPY.types.embed.label;
    case "whatsapp_click": return BLOCKS_COPY.types.whatsapp.label;
    case "pix_copy":
    case "pix_pay_click": return BLOCKS_COPY.types.pix.label;
    case "form_submit": return BLOCKS_COPY.types.form.label;
    default: return "";
  }
}
