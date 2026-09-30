/**
 * WhatsApp numbers are stored as E.164 digits without "+" (mirror of private.is_valid_whatsapp_phone).
 * The wa.me URL is built at render time and never stored, so a number cannot smuggle a host.
 */
const STORED_PHONE_PATTERN = /^[1-9]\d{7,14}$/;
const BRAZIL_PATTERN = /^55[1-9]\d{9,10}$/;

export function isValidWhatsAppPhone(value: unknown): value is string {
  if (typeof value !== "string" || !STORED_PHONE_PATTERN.test(value)) return false;
  return !value.startsWith("55") || BRAZIL_PATTERN.test(value);
}

/**
 * Accepts Brazilian input ("(11) 91234-5678", "11912345678", "0 11 91234-5678", "+55 11 …") and
 * international numbers written with "+" or "00". Without a prefix the number is read as Brazilian.
 */
export function normalizeWhatsAppPhone(input: string): { ok: true; phone: string } | { ok: false } {
  const trimmed = input.trim();
  if (!trimmed || /[^\d\s()+.-]/.test(trimmed) || trimmed.lastIndexOf("+") > 0) return { ok: false };
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    // international as typed
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else {
    if (digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  }
  return isValidWhatsAppPhone(digits) ? { ok: true, phone: digits } : { ok: false };
}

/** Display form: "+55 (11) 91234-5678" for Brazil, "+<digits>" otherwise. */
export function formatWhatsAppPhone(phone: string): string {
  const brazil = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(phone);
  if (brazil) return `+55 (${brazil[1]}) ${brazil[2]}-${brazil[3]}`;
  return `+${phone}`;
}

export function whatsAppHref(phone: string, message: string): string {
  const text = message.trim();
  return `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
