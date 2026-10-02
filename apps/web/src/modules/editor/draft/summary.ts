import { BLOCKS_COPY } from "@/content/pt-BR";
import { SOCIAL_NETWORK_IDS, SOCIAL_NETWORKS, type BlockInput } from "@/modules/blocks";

const SUMMARY_MAX = 60;

function shorten(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat;
}

/** One-line description of a block for the collapsed card in the editor list. */
export function blockSummary(input: BlockInput): string {
  switch (input.type) {
    case "link": return shorten(input.title) || shorten(input.url) || BLOCKS_COPY.summary.emptyLink;
    case "text": return shorten(input.text) || BLOCKS_COPY.summary.emptyText;
    case "social": {
      const filled = SOCIAL_NETWORK_IDS.filter((network) => (input.items[network] ?? "").trim() !== "");
      if (filled.length === 0) return BLOCKS_COPY.summary.emptySocial;
      return shorten(filled.map((network) => SOCIAL_NETWORKS[network].label).join(", "));
    }
    case "whatsapp": return shorten([input.label, input.phone].filter((part) => part.trim() !== "").join(" · ")) || BLOCKS_COPY.types.whatsapp.label;
    case "divider": return BLOCKS_COPY.summary.divider;
    case "image": return input.mediaId === "" ? BLOCKS_COPY.summary.emptyImage : input.decorative ? BLOCKS_COPY.summary.decorativeImage : shorten(input.alt) || BLOCKS_COPY.types.image.label;
    case "embed": return shorten(input.title) || shorten(input.url) || BLOCKS_COPY.summary.emptyEmbed;
    case "pix": return shorten([input.label, input.key].filter((part) => part.trim() !== "").join(" · ")) || BLOCKS_COPY.summary.emptyPix;
    case "form": return shorten(input.title) || BLOCKS_COPY.summary.emptyForm;
  }
}
