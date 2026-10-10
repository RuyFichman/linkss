/**
 * Whether a signed-in person must stop at /aceite. Terms and Privacy are accepted together, so the
 * gate closes only while both are active: with a single active text /aceite could record nothing
 * and the whole app would be locked behind a screen with no way forward.
 */
export function acceptancePending(documents: readonly { kind: string; accepted: boolean }[]): boolean {
  const terms = documents.find((document) => document.kind === "terms");
  const privacy = documents.find((document) => document.kind === "privacy");
  if (!terms || !privacy) return false;
  return !terms.accepted || !privacy.accepted;
}
