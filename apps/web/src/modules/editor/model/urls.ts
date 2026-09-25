const DANGEROUS_SCHEMES = /^(javascript|data|vbscript|file):/i;
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

export type UrlResult = { ok: true; url: string } | { ok: false; reason: string };

export function normalizeUrl(input: string): UrlResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "Informe um endereço." };
  const compact = trimmed.replace(/[\u0000-\u0020]+/g, "");
  if (DANGEROUS_SCHEMES.test(compact)) return { ok: false, reason: "Este tipo de endereço não é permitido." };
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) return { ok: false, reason: "Use um endereço http, https, e-mail ou telefone." };
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, reason: "O endereço parece incompleto. Revise e tente novamente." };
  }
}

export type WhatsAppResult = { ok: true; url: string; phone: string } | { ok: false; reason: string };

export function buildWhatsAppUrl(input: string, message = ""): WhatsAppResult {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("55")) digits = `55${digits}`;
  if (!/^55\d{10,11}$/.test(digits)) return { ok: false, reason: "Informe DDD e número de celular ou telefone." };
  const url = new URL(`https://wa.me/${digits}`);
  if (message.trim()) url.searchParams.set("text", message.trim());
  return { ok: true, url: url.toString(), phone: digits };
}

export function detectVideoProvider(url: string): "youtube" | "vimeo" | "unknown" {
  const value = url.toLowerCase();
  if (value.includes("youtube.com") || value.includes("youtu.be")) return "youtube";
  if (value.includes("vimeo.com")) return "vimeo";
  return "unknown";
}
