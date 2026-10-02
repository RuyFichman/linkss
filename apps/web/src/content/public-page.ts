// Copy of the public page (pt-BR). Kept apart from content/pt-BR.ts because the public page's client
// components import it: everything in this file is shipped to visitors, so nothing else belongs here.
export const PUBLIC_PAGE_COPY = {
  notFoundTitle: "Página não encontrada",
  notFound: "Não existe uma página publicada neste endereço. Confira se o link está correto.",
  suspendedTitle: "Página indisponível",
  suspended: "Esta página está temporariamente indisponível.",
  errorTitle: "Não foi possível carregar esta página",
  error: "Tente novamente em instantes.",
  retry: "Tentar novamente",
  badge: (product: string) => `Criado com ${product}`,
  defaultDescription: (title: string) => `Links e contatos de ${title}.`,
  socialLabel: "Redes sociais",
  linksLabel: "Links",
  opensExternal: (network: string) => `${network} (abre fora desta página)`,
  goHome: "Ir para a página inicial",
  whatsappSuffix: " (WhatsApp)",
  avatarAlt: (title: string) => `Foto de ${title}`,
  embed: {
    load: (provider: string) => `Tocar para carregar no ${provider}`,
    privacy: (provider: string) => `Ao carregar, o ${provider} recebe dados da sua visita.`,
    frameTitle: (title: string, provider: string) => `${title} (${provider})`,
    kind: { video: "Vídeo", audio: "Áudio" },
  },
  pix: {
    keyLabel: (type: string) => `Chave Pix (${type})`,
    copy: "Copiar chave",
    copied: "Chave copiada.",
    copyFailed: "Não foi possível copiar. Selecione a chave e copie manualmente.",
    pay: "Abrir link de pagamento",
    notice: "O pagamento acontece no app do seu banco. Confira o nome de quem recebe antes de confirmar.",
  },
  form: {
    fields: { name: "Nome", email: "E-mail", phone: "Telefone com DDD", message: "Mensagem (opcional)" },
    honeypot: "Deixe este campo em branco",
    consentOptional: " (opcional)",
    sending: "Enviando…",
    success: "Recebemos seus dados. Obrigado!",
    invalid: "Revise os campos indicados e envie de novo.",
    problems: {
      name: { required: "Informe seu nome.", invalid: "Confira o nome informado.", too_long: "Use no máximo 100 caracteres." },
      email: { required: "Informe seu e-mail.", invalid: "Digite um e-mail válido, como voce@exemplo.com.", too_long: "E-mail muito longo." },
      phone: { required: "Informe seu telefone com DDD.", invalid: "Confira o telefone: use só números, com DDD.", too_long: "Telefone muito longo." },
      message: { required: "Escreva uma mensagem.", invalid: "A mensagem tem caracteres que não são aceitos.", too_long: "Use no máximo 1.000 caracteres." },
    },
    consentRequired: "Marque a caixa de consentimento para enviar.",
    rateLimited: "Recebemos muitos envios em pouco tempo. Aguarde alguns minutos e tente de novo.",
    unavailable: "Este formulário não está disponível agora. Tente novamente mais tarde.",
    failed: "Não foi possível enviar agora. Seus dados não foram guardados. Tente novamente.",
    previewNote: "Na prévia, o formulário não envia dados.",
  },
} as const;

/** Names of the Pix key types as shown to visitors. */
export const PIX_KEY_TYPE_LABELS = { cpf: "CPF", cnpj: "CNPJ", phone: "celular", email: "e-mail", random: "chave aleatória" } as const;
