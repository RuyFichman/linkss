import type { Widen } from "./types";
import type { PUBLIC_PAGE_COPY as PORTUGUESE, PIX_KEY_TYPE_LABELS as PORTUGUESE_PIX } from "./public-page";

// Copy of the public page in Spanish (ADR 0022), for pages whose owner chose Spanish. Like
// public-page.ts it is shipped to visitors, so nothing else belongs here.
export const PUBLIC_PAGE_COPY = {
  notFoundTitle: "Página no encontrada",
  notFound: "No hay ninguna página publicada en esta dirección. Comprueba que el enlace es correcto.",
  suspendedTitle: "Página no disponible",
  suspended: "Esta página no está disponible temporalmente.",
  errorTitle: "No se ha podido cargar esta página",
  error: "Inténtalo de nuevo en unos instantes.",
  retry: "Intentar de nuevo",
  badge: (product: string) => `Creado con ${product}`,
  defaultDescription: (title: string) => `Enlaces y contactos de ${title}.`,
  socialLabel: "Redes sociales",
  linksLabel: "Enlaces",
  opensExternal: (network: string) => `${network} (se abre fuera de esta página)`,
  goHome: "Ir a la página de inicio",
  whatsappSuffix: " (WhatsApp)",
  avatarAlt: (title: string) => `Foto de ${title}`,
  embed: {
    load: (provider: string) => `Tocar para cargar en ${provider}`,
    privacy: (provider: string) => `Al cargarlo, ${provider} recibe datos de tu visita.`,
    frameTitle: (title: string, provider: string) => `${title} (${provider})`,
    kind: { video: "Vídeo", audio: "Audio" },
  },
  pix: {
    keyLabel: (type: string) => `Clave Pix (${type})`,
    copy: "Copiar clave",
    copied: "Clave copiada.",
    copyFailed: "No se ha podido copiar. Selecciona la clave y cópiala a mano.",
    pay: "Abrir el enlace de pago",
    notice: "El pago se hace en la app de tu banco (Pix, Brasil). Comprueba el nombre de quien lo recibe antes de confirmar.",
  },
  form: {
    fields: { name: "Nombre", email: "Correo electrónico", phone: "Teléfono con prefijo", message: "Mensaje (opcional)" },
    honeypot: "Deja este campo en blanco",
    consentOptional: " (opcional)",
    sending: "Enviando…",
    success: "Hemos recibido tus datos. ¡Gracias!",
    invalid: "Revisa los campos indicados y vuelve a enviarlo.",
    problems: {
      name: { required: "Indica tu nombre.", invalid: "Revisa el nombre indicado.", too_long: "Usa como máximo 100 caracteres." },
      email: { required: "Indica tu correo electrónico.", invalid: "Escribe un correo válido, como tu@ejemplo.es.", too_long: "Correo demasiado largo." },
      phone: { required: "Indica tu teléfono con prefijo.", invalid: "Revisa el teléfono: usa solo números, con el prefijo.", too_long: "Teléfono demasiado largo." },
      message: { required: "Escribe un mensaje.", invalid: "El mensaje tiene caracteres que no se aceptan.", too_long: "Usa como máximo 1.000 caracteres." },
    },
    consentRequired: "Marca la casilla de consentimiento para enviar.",
    rateLimited: "Hemos recibido muchos envíos en poco tiempo. Espera unos minutos e inténtalo de nuevo.",
    unavailable: "Este formulario no está disponible ahora. Inténtalo más tarde.",
    failed: "No se ha podido enviar ahora. Tus datos no se han guardado. Inténtalo de nuevo.",
    previewNote: "En la vista previa, el formulario no envía datos.",
  },
  consent: {
    label: "Aviso de privacidad",
    text: (vendors: string) => `Esta página usa ${vendors} para medir visitas y anuncios. Si aceptas, se envían datos de tu visita a ${vendors.includes(" y ") ? "esas empresas" : "esa empresa"}.`,
    meta: "el Meta Pixel",
    ga: "Google Analytics",
    and: " y ",
    accept: "Aceptar",
    refuse: "Rechazar",
    change: "Preferencias de privacidad",
  },
  report: "Denunciar esta página",
} as const satisfies Widen<typeof PORTUGUESE>;

/** Names of the Pix key types as shown to visitors. */
export const PIX_KEY_TYPE_LABELS = { cpf: "CPF", cnpj: "CNPJ", phone: "móvil", email: "correo electrónico", random: "clave aleatoria" } as const satisfies Widen<typeof PORTUGUESE_PIX>;
