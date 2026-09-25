import type { WaitlistSegment, WaitlistSignup, WaitlistVariant } from "./types";

const SEGMENTS: WaitlistSegment[] = ["agency", "freelancer", "creator", "local-business", "other"];
const VARIANTS: WaitlistVariant[] = ["neutral", "agencies", "professionals"];
const MINIMUM_SUBMIT_MS = 1_500;

function value(formData: FormData, key: string): string { const entry = formData.get(key); return typeof entry === "string" ? entry.trim() : ""; }

export type WaitlistValidation = { ok: true; signup: WaitlistSignup } | { ok: false; errors: Record<string, string>; bot: boolean };

export function validateWaitlist(formData: FormData, now = Date.now()): WaitlistValidation {
  const errors: Record<string, string> = {}; const honeypot = value(formData, "companyWebsite"); const startedAt = Number(value(formData, "startedAt")); const tooFast = !Number.isFinite(startedAt) || now - startedAt < MINIMUM_SUBMIT_MS;
  if (honeypot || tooFast) return { ok: false, errors: {}, bot: true };
  const name = value(formData, "name"); const email = value(formData, "email").toLowerCase(); const whatsapp = value(formData, "whatsapp"); const segment = value(formData, "segment") as WaitlistSegment; const managedProfiles = value(formData, "managedProfiles"); const currentTool = value(formData, "currentTool"); const willingnessToPay = value(formData, "willingnessToPay"); const pilotInterest = value(formData, "pilotInterest") === "yes"; const consent = value(formData, "consent") === "yes"; const variantValue = value(formData, "variant") as WaitlistVariant;
  if (name.length < 2 || name.length > 100) errors.name = "Informe seu nome com 2 a 100 caracteres.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = "Digite um e-mail válido.";
  if (whatsapp && !/^\+?[\d\s().-]{10,20}$/.test(whatsapp)) errors.whatsapp = "Confira o DDD e o número do WhatsApp.";
  if (!SEGMENTS.includes(segment)) errors.segment = "Escolha a opção que mais se aproxima do seu trabalho.";
  if (!managedProfiles) errors.managedProfiles = "Informe quantas páginas ou clientes você administra.";
  if (!willingnessToPay) errors.willingnessToPay = "Escolha uma faixa para ajudar na pesquisa.";
  if (!consent) errors.consent = "Precisamos do seu consentimento para guardar e responder este cadastro.";
  if (!VARIANTS.includes(variantValue)) errors.variant = "Não foi possível identificar a origem do formulário.";
  if (Object.keys(errors).length > 0) return { ok: false, errors, bot: false };
  return { ok: true, signup: { name, email, whatsapp: whatsapp || undefined, segment, managedProfiles, currentTool: currentTool || undefined, willingnessToPay, pilotInterest, consent: true, variant: variantValue, utmSource: value(formData, "utmSource") || undefined, utmMedium: value(formData, "utmMedium") || undefined, utmCampaign: value(formData, "utmCampaign") || undefined, referrer: value(formData, "referrer") || undefined } };
}
