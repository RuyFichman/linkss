import type { PageTheme, TemplateDefinition } from "../model";

const localTheme: PageTheme = { id: "local-warm", name: "Bairro acolhedor", pageBg: "#F5EFE5", pageText: "#231F1A", pageMuted: "#5E574E", pageFont: "Arial, Helvetica, sans-serif", headingFont: "Georgia, 'Times New Roman', serif", buttonBg: "#1F5B49", buttonText: "#FFFFFF", buttonStyle: "filled", buttonRadius: 16 };
const creatorTheme: PageTheme = { id: "creator-bold", name: "Criador vibrante", pageBg: "#17142B", pageText: "#FFFFFF", pageMuted: "#D2CDEA", pageFont: "Arial, Helvetica, sans-serif", headingFont: "Arial Black, Arial, sans-serif", buttonBg: "#F2CF4A", buttonText: "#201A00", buttonStyle: "filled", buttonRadius: 28 };
const serviceTheme: PageTheme = { id: "service-calm", name: "Serviço sereno", pageBg: "#EEF5F2", pageText: "#16352D", pageMuted: "#49665E", pageFont: "Trebuchet MS, Arial, sans-serif", headingFont: "Georgia, serif", buttonBg: "#225E50", buttonText: "#FFFFFF", buttonStyle: "outline", buttonRadius: 10 };
const shopTheme: PageTheme = { id: "shop-grid", name: "Loja direta", pageBg: "#FFF8ED", pageText: "#2E2118", pageMuted: "#6B5849", pageFont: "Verdana, Arial, sans-serif", headingFont: "Verdana, Arial, sans-serif", buttonBg: "#C14C20", buttonText: "#FFFFFF", buttonStyle: "soft", buttonRadius: 8 };
const eventTheme: PageTheme = { id: "event-night", name: "Evento noturno", pageBg: "#100F12", pageText: "#FFFFFF", pageMuted: "#C9C5CE", pageFont: "Arial, Helvetica, sans-serif", headingFont: "Impact, Arial Black, sans-serif", buttonBg: "#C21870", buttonText: "#FFFFFF", buttonStyle: "filled", buttonRadius: 4 };

export const TEMPLATES = [
  { id: "negocio-local", name: "Negócio local", description: "Conversa, localização e agenda em destaque.", useCase: "Salão, café, barbearia ou restaurante", intendedValueAction: "Conversa no WhatsApp", theme: localTheme, seedBlocks: [
    { id: "local-text", type: "text", visible: true, valueAction: false, text: "Atendimento próximo, do seu jeito." },
    { id: "local-wa", type: "whatsapp", visible: true, valueAction: true, label: "Reservar pelo WhatsApp", phone: "+55 11 99999-0000", message: "Olá! Quero fazer uma reserva." },
    { id: "local-map", type: "link", visible: true, valueAction: false, title: "Como chegar", url: "https://maps.google.com" },
  ] },
  { id: "criador", name: "Criador e lançamento", description: "Vídeo, lista de interesse e redes sociais.", useCase: "Creator, curso ou conteúdo autoral", intendedValueAction: "Cadastro de interesse", theme: creatorTheme, seedBlocks: [
    { id: "creator-video", type: "video", visible: true, valueAction: false, title: "Conheça o projeto", url: "https://youtube.com/watch?v=demo", provider: "youtube" },
    { id: "creator-form", type: "form", visible: true, valueAction: true, title: "Receba as novidades", fields: ["name", "email"], consentText: "Aceito receber novidades sobre este projeto." },
    { id: "creator-social", type: "social", visible: true, valueAction: false, items: [{ network: "instagram", url: "https://instagram.com/exemplo" }, { network: "youtube", url: "https://youtube.com/@exemplo" }] },
  ] },
  { id: "profissional", name: "Profissional independente", description: "Portfólio enxuto com agenda e conversa.", useCase: "Fotografia, treino, design ou consultoria", intendedValueAction: "Agendamento", theme: serviceTheme, seedBlocks: [
    { id: "service-text", type: "text", visible: true, valueAction: false, text: "Projetos feitos com atenção a cada detalhe." },
    { id: "service-book", type: "link", visible: true, valueAction: true, title: "Ver horários disponíveis", url: "https://cal.com/exemplo" },
    { id: "service-wa", type: "whatsapp", visible: true, valueAction: true, label: "Conversar sobre seu projeto", phone: "+55 21 98888-0000", message: "Olá! Quero conversar sobre um projeto." },
  ] },
  { id: "loja", name: "Pequena loja", description: "Catálogo, pagamento externo e atendimento.", useCase: "Loja local ou catálogo online", intendedValueAction: "Abrir catálogo ou pagamento", theme: shopTheme, seedBlocks: [
    { id: "shop-catalog", type: "link", visible: true, valueAction: true, title: "Ver catálogo", url: "https://example.com/catalogo" },
    { id: "shop-pix", type: "pix", visible: true, valueAction: true, label: "Copiar chave Pix", keyType: "email", key: "pagamentos@lojaficticia.test", paymentUrl: "https://example.com/pagar" },
    { id: "shop-wa", type: "whatsapp", visible: true, valueAction: true, label: "Tirar dúvida no WhatsApp", phone: "+55 31 97777-0000", message: "Olá! Tenho uma dúvida sobre um produto." },
  ] },
  { id: "evento", name: "Evento e artista", description: "Ingressos, lista VIP e canais oficiais.", useCase: "Show, evento ou lançamento cultural", intendedValueAction: "Ingresso ou lista VIP", theme: eventTheme, seedBlocks: [
    { id: "event-ticket", type: "link", visible: true, valueAction: true, title: "Comprar ingresso em parceiro", url: "https://example.com/ingressos" },
    { id: "event-form", type: "form", visible: true, valueAction: true, title: "Entrar na lista VIP", fields: ["name", "email", "phone"], consentText: "Aceito receber informações sobre este evento." },
    { id: "event-separator", type: "separator", visible: true, valueAction: false, style: "dots" },
    { id: "event-social", type: "social", visible: true, valueAction: false, items: [{ network: "instagram", url: "https://instagram.com/eventoficticio" }, { network: "tiktok", url: "https://tiktok.com/@eventoficticio" }] },
  ] },
] as const satisfies readonly TemplateDefinition[];

export function getTemplate(id: string): TemplateDefinition | undefined { return TEMPLATES.find((template) => template.id === id); }
