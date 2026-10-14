/**
 * Where customers write for help. A server-side setting (`SUPPORT_EMAIL`) rather than a constant:
 * the mailbox is the founder's to choose and exists outside this repository. While it is not set,
 * the help center says how support works during the private pilot instead of showing an address
 * nobody reads.
 */
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;

export function supportEmailFrom(value: string | undefined): string | null {
  const email = (value ?? "").trim();
  return email.length <= 254 && EMAIL.test(email) ? email.toLowerCase() : null;
}

export function supportEmail(): string | null {
  return supportEmailFrom(process.env.SUPPORT_EMAIL);
}
