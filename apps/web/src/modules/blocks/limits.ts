/**
 * Technical caps for draft content (abuse and performance limits, not plan limits). Each one is
 * also enforced by private.validate_profile_draft / the profiles check constraints; change both.
 */
export const MAX_BLOCKS = 100;
/** Serialized size of the whole `blocks` array, in UTF-8 bytes (`octet_length(blocks::text)`). */
export const MAX_BLOCKS_BYTES = 65_536;
export const LINK_TITLE_MAX_LENGTH = 80;
export const URL_MAX_LENGTH = 2048;
export const TEXT_MAX_LENGTH = 1000;
export const WHATSAPP_LABEL_MAX_LENGTH = 80;
export const WHATSAPP_MESSAGE_MAX_LENGTH = 500;
export const SOCIAL_ITEMS_MAX = 8;

/** Length in Unicode code points, like Postgres char_length() (an emoji counts once). */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}
