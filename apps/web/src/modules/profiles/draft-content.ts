import { APP_COPY } from "@/content/pt-BR";
import { normalizeUrl } from "@/modules/editor/model/urls";
import { isAllowedSocialUrl, isSocialNetwork, normalizeSocialInput, SOCIAL_NETWORK_IDS, SOCIAL_NETWORKS, type SocialLink, type SocialNetwork } from "@/modules/publishing/social";

/**
 * Draft content stored on profiles.blocks / profiles.social_links. Mirrors
 * private.validate_profile_draft(); the database rejects anything this module would reject.
 * Sprint 3 supports link blocks only; the Sprint 4 editor extends both sides together.
 */
export const LINK_TITLE_MAX_LENGTH = 80;
export const LINK_URL_MAX_LENGTH = 2048;
export const MAX_BLOCKS = 100;

export interface DraftLinkBlock {
  id: string;
  type: "link";
  title: string;
  url: string;
  visible: boolean;
}

export type LinkField = "title" | "url";
export type LinkValidation =
  | { ok: true; value: { title: string; url: string } }
  | { ok: false; errors: Partial<Record<LinkField, string>> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STORED_URL_PATTERN = /^(https?:\/\/|mailto:|tel:)[^\s\u0000-\u001f\u007f]+$/;

/** Normalizes a link destination to the stored form (http/https/mailto/tel only). */
export function normalizeLinkUrl(input: string): { ok: true; url: string } | { ok: false; message: string } {
  const trimmed = input.trim();
  const result = normalizeUrl(trimmed);
  if (!result.ok) return { ok: false, message: trimmed ? result.reason : APP_COPY.links.urlRequired };
  let url = result.url;
  // Phone numbers are typed with spaces and punctuation; tel: keeps only "+" and digits.
  if (url.startsWith("tel:")) url = `tel:${url.slice(4).replace(/[^\d+]/g, "")}`;
  if (url === "tel:" || url === "mailto:" || url.length > LINK_URL_MAX_LENGTH || !STORED_URL_PATTERN.test(url)) {
    return { ok: false, message: APP_COPY.links.urlInvalid };
  }
  return { ok: true, url };
}

export function validateLinkInput(input: { title: unknown; url: unknown }): LinkValidation {
  const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
  const url = normalizeLinkUrl(typeof input.url === "string" ? input.url : "");
  const errors: Partial<Record<LinkField, string>> = {};
  if (title.length < 1 || title.length > LINK_TITLE_MAX_LENGTH) errors.title = APP_COPY.links.titleError;
  if (!url.ok) errors.url = url.message;
  return url.ok && !errors.title ? { ok: true, value: { title, url: url.url } } : { ok: false, errors };
}

export type SocialFormValidation =
  | { ok: true; value: SocialLink[] }
  | { ok: false; errors: Partial<Record<SocialNetwork, string>> };

/** One optional field per network; empty fields are removed. Order follows SOCIAL_NETWORK_IDS. */
export function validateSocialForm(input: Partial<Record<SocialNetwork, unknown>>): SocialFormValidation {
  const links: SocialLink[] = [];
  const errors: Partial<Record<SocialNetwork, string>> = {};
  for (const network of SOCIAL_NETWORK_IDS) {
    const raw = input[network];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const result = normalizeSocialInput(network, raw);
    if (result.ok) links.push({ network, url: result.url });
    else errors[network] = result.reason === "wrong_network" ? APP_COPY.social.wrongNetwork(SOCIAL_NETWORKS[network].label) : APP_COPY.social.invalid;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: links };
}

/** Tolerant reader for the stored JSON: drops anything that does not match the current shape. */
export function parseDraftBlocks(value: unknown): DraftLinkBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): DraftLinkBlock[] => {
    if (!item || typeof item !== "object") return [];
    const block = item as Record<string, unknown>;
    if (block.type !== "link" || typeof block.id !== "string" || !UUID_PATTERN.test(block.id)) return [];
    if (typeof block.title !== "string" || typeof block.url !== "string" || typeof block.visible !== "boolean") return [];
    return [{ id: block.id, type: "link", title: block.title, url: block.url, visible: block.visible }];
  });
}

export function parseSocialLinks(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SocialLink[] => {
    if (!item || typeof item !== "object") return [];
    const link = item as Record<string, unknown>;
    if (!isSocialNetwork(link.network) || typeof link.url !== "string" || !isAllowedSocialUrl(link.network, link.url)) return [];
    return [{ network: link.network, url: link.url }];
  });
}
