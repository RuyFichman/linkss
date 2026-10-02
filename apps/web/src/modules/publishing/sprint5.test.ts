import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftBlock } from "@/modules/blocks";
import { mediaIdsIn } from "@/modules/media/references";
import type { ThemeTokens } from "@/modules/themes/tokens";
import { buildDocumentJson, documentFromDraft, findPublishedForm, parsePublishedDocument } from "./document";

// The font loader and Server Actions only exist inside the Next.js compiler and runtime.
vi.mock("@/modules/themes/fonts", () => ({ THEME_FONT_FAMILY: { system: "Arial, sans-serif", serif: "Georgia, serif", poppins: "Poppins, sans-serif", lora: "Lora, serif" } }));
vi.mock("@/modules/leads/actions", () => ({ submitLeadAction: async () => ({ status: "idle" }) }));

const MEDIA = "9a000000-0000-4000-8000-000000000001";
const AVATAR = "9a000000-0000-4000-8000-0000000000aa";
const THEME: ThemeTokens = { background: "#17142b", button: "#f2cf4a", buttonStyle: "filled", corners: "pill", spacing: "relaxed", font: "poppins" };
const XSS = '"><script>alert(1)</script><img src=x onerror=alert(1)>';

const blocks: DraftBlock[] = [
  { id: "b1", type: "image", visible: true, mediaId: MEDIA, width: 1344, height: 756, alt: "Vitrine", decorative: false },
  { id: "b2", type: "link", visible: false, title: "Oculto", url: "https://exemplo.com.br/" },
  { id: "b3", type: "embed", visible: true, provider: "youtube", ref: "dQw4w9WgXcQ", title: "Vídeo" },
  { id: "b4", type: "pix", visible: true, label: "Pix", keyType: "cpf", key: "52998224725", paymentUrl: "https://pagamento.exemplo.com.br/x" },
  { id: "b5", type: "form", visible: true, title: "Contato", fields: ["name", "email"], buttonLabel: "Enviar", consentText: "Aceito.", consentRequired: true },
  { id: "b6", type: "image", visible: true, mediaId: MEDIA, width: 448, height: 448, alt: "", decorative: true },
];

describe("draft to document mapping with theme and media (mirror of private.build_publication_document)", () => {
  it("keeps order, drops hidden blocks, copies theme and media references, and stays at schema version 2", () => {
    const json = buildDocumentJson({ title: "Studio", bio: "Bio", avatarPath: AVATAR, theme: THEME, blocks });
    expect(json).toEqual({
      schemaVersion: 2, title: "Studio", bio: "Bio", avatarPath: AVATAR, theme: THEME,
      blocks: [
        { id: "b1", type: "image", mediaId: MEDIA, width: 1344, height: 756, alt: "Vitrine" },
        { id: "b3", type: "embed", provider: "youtube", ref: "dQw4w9WgXcQ", title: "Vídeo" },
        { id: "b4", type: "pix", label: "Pix", keyType: "cpf", key: "52998224725", paymentUrl: "https://pagamento.exemplo.com.br/x" },
        { id: "b5", type: "form", title: "Contato", fields: ["name", "email"], buttonLabel: "Enviar", consentText: "Aceito.", consentRequired: true },
        { id: "b6", type: "image", mediaId: MEDIA, width: 448, height: 448, alt: "" },
      ],
    });
    expect([...mediaIdsIn(json)].sort()).toEqual([MEDIA, AVATAR].sort());
  });

  it("publishes the pre-Sprint-5 shape when a page has no theme", () => {
    const json = buildDocumentJson({ title: "Studio", bio: "", avatarPath: null, theme: null, blocks: [] });
    expect(json).toEqual({ schemaVersion: 2, title: "Studio", bio: "", avatarPath: null, blocks: [] });
    expect("theme" in json).toBe(false);
  });

  it("reads back what it writes (the preview is the published page)", () => {
    const document = documentFromDraft({ title: "Studio", bio: "", avatarPath: AVATAR, theme: THEME, blocks });
    expect(document).toMatchObject({ schemaVersion: 2, sourceSchemaVersion: 2, avatarPath: AVATAR, theme: THEME });
    expect(document.blocks.map((block) => block.id)).toEqual(["b1", "b3", "b4", "b5", "b6"]);
    expect(findPublishedForm(document, "b5")).toMatchObject({ fields: ["name", "email"], consentRequired: true });
    expect(findPublishedForm(document, "b4")).toBeNull();
    expect(findPublishedForm(document, "missing")).toBeNull();
  });
});

describe("renderer contract: old snapshots and defensive parsing", () => {
  it("renders version 1 and version 2 snapshots published before Sprint 5 with the classic look and no media", () => {
    const v1 = parsePublishedDocument({ schemaVersion: 1, title: "Antiga", bio: "", avatarPath: null, socialLinks: [{ network: "instagram", url: "https://www.instagram.com/antiga" }], blocks: [{ id: "l", type: "link", title: "Site", url: "https://exemplo.com.br/" }] });
    const v2 = parsePublishedDocument({ schemaVersion: 2, title: "Antiga", bio: "", avatarPath: null, blocks: [{ id: "w", type: "whatsapp", label: "Zap", phone: "5511912345678", message: "" }] });
    expect(v1).toMatchObject({ sourceSchemaVersion: 1, theme: null, avatarPath: null });
    expect(v2).toMatchObject({ sourceSchemaVersion: 2, theme: null, avatarPath: null });
    expect(v1?.blocks.map((block) => block.type)).toEqual(["social", "link"]);
    // A version 1 document never had the new types: they are not read from it.
    expect(parsePublishedDocument({ schemaVersion: 1, title: "x", blocks: [{ id: "e", type: "embed", provider: "youtube", ref: "dQw4w9WgXcQ", title: "x" }] })?.blocks).toEqual([]);
  });

  it("drops unsafe blocks and falls back to the classic look for an invalid theme", () => {
    const document = parsePublishedDocument({
      schemaVersion: 2, title: "Ana", bio: "", avatarPath: "https://evil.example/a.png",
      theme: { ...THEME, button: "url(javascript:alert(1))" },
      blocks: [
        { id: "ok", type: "image", mediaId: MEDIA, width: 448, height: 300, alt: "Foto" },
        { id: "i1", type: "image", mediaId: "https://evil.example/x.png", width: 448, height: 300, alt: "" },
        { id: "i2", type: "image", mediaId: MEDIA, width: 99999, height: 300, alt: "" },
        { id: "e1", type: "embed", provider: "evil", ref: "dQw4w9WgXcQ", title: "x" },
        { id: "e2", type: "embed", provider: "youtube", ref: XSS, title: "x" },
        { id: "p1", type: "pix", label: "Pix", keyType: "cpf", key: "00000000000", paymentUrl: "" },
        { id: "p2", type: "pix", label: "Pix", keyType: "email", key: "ana@exemplo.com.br", paymentUrl: "javascript:alert(1)" },
        { id: "f1", type: "form", title: "x", fields: ["name"], buttonLabel: "x", consentText: "x", consentRequired: true },
        { id: "f2", type: "form", title: "x", fields: ["email"], buttonLabel: "x", consentText: "x", consentRequired: "yes" },
      ],
    });
    expect(document?.theme).toBeNull();
    expect(document?.avatarPath).toBeNull();
    expect(document?.blocks.map((block) => block.id)).toEqual(["ok", "p2"]);
    expect(document?.blocks[1]).toMatchObject({ paymentUrl: "" });
  });
});

describe("public page markup", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projeto.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function render(draft: Parameters<typeof documentFromDraft>[0], interactive = true) {
    const { PublicPageView } = await import("./render/public-page-view");
    return renderToStaticMarkup(createElement(PublicPageView, { document: documentFromDraft(draft), showBadge: true, interactive, slug: interactive ? "studio" : null }));
  }

  it("never interprets text typed by the person as markup, in any block", async () => {
    const html = await render({
      title: XSS, bio: XSS, avatarPath: null, theme: null,
      blocks: [
        { id: "t", type: "text", visible: true, text: XSS },
        { id: "l", type: "link", visible: true, title: XSS, url: "https://exemplo.com.br/" },
        { id: "i", type: "image", visible: true, mediaId: MEDIA, width: 448, height: 300, alt: XSS, decorative: false },
        { id: "e", type: "embed", visible: true, provider: "vimeo", ref: "123456789", title: XSS },
        { id: "p", type: "pix", visible: true, label: XSS, keyType: "email", key: "ana@exemplo.com.br", paymentUrl: "" },
        { id: "f", type: "form", visible: true, title: XSS, fields: ["email"], buttonLabel: XSS, consentText: XSS, consentRequired: true },
      ],
    });
    // The only script element is React's own form helper, appended after the page; none comes from the content.
    expect(html.slice(0, html.indexOf("</main>"))).not.toContain("<script");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toMatch(/ onerror="/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<iframe");
  });

  it("gives every image explicit dimensions, a srcset and lazy loading below the first block", async () => {
    const html = await render({
      title: "Studio", bio: "", avatarPath: AVATAR, theme: THEME,
      blocks: [
        { id: "first", type: "image", visible: true, mediaId: MEDIA, width: 1344, height: 756, alt: "Capa", decorative: false },
        { id: "later", type: "image", visible: true, mediaId: MEDIA, width: 1000, height: 500, alt: "", decorative: true },
      ],
    });
    const images = [...html.matchAll(/<img [^>]*>/g)].map((match) => match[0]);
    expect(images).toHaveLength(3);
    expect(images[0]).toContain(`${AVATAR}/96.webp 1x`);
    expect(images[0]).toContain('width="96" height="96"');
    expect(images[1]).toContain('width="1344" height="756"');
    expect(images[1]).toContain(`${MEDIA}/448.webp 448w, https://projeto.supabase.co/storage/v1/object/public/media/${MEDIA}/896.webp 896w, https://projeto.supabase.co/storage/v1/object/public/media/${MEDIA}/1344.webp 1344w`);
    expect(images[1]).toContain('sizes="(max-width: 480px) calc(100vw - 2rem), 448px"');
    expect(images[1]).toContain('loading="eager"');
    expect(images[2]).toContain('loading="lazy"');
    expect(images[2]).toContain("1000.webp 1000w");
    expect(images[2]).toContain('alt=""');
    for (const image of images) expect(image).toContain(".webp");
  });

  it("applies the theme through custom properties derived from tokens", async () => {
    const themed = await render({ title: "Studio", bio: "", avatarPath: null, theme: THEME, blocks: [] });
    expect(themed).toContain("--page-bg:#17142b");
    expect(themed).toContain("--btn-bg:#f2cf4a");
    expect(themed).toContain("--page-radius:28px");
    expect(themed).toContain("--page-gap:20px");
    expect(themed).toContain("font-family:Poppins");
    const classic = await render({ title: "Studio", bio: "", avatarPath: null, theme: null, blocks: [] });
    expect(classic).toContain("--page-bg:#f5f6fa");
    expect(classic).toContain("--btn-bg:#ffffff");
    expect(classic).toContain("--page-radius:16px");
    expect(classic).toContain("--page-gap:12px");
  });

  it("renders embeds as a link to the provider (no iframe, no provider request) and keeps the analytics hooks", async () => {
    const html = await render({
      title: "Studio", bio: "", avatarPath: null, theme: null,
      blocks: [
        { id: "e", type: "embed", visible: true, provider: "youtube", ref: "dQw4w9WgXcQ", title: "Vídeo" },
        { id: "p", type: "pix", visible: true, label: "Pix", keyType: "cpf", key: "52998224725", paymentUrl: "https://pagamento.exemplo.com.br/x" },
        { id: "f", type: "form", visible: true, title: "Contato", fields: ["name", "email", "message"], buttonLabel: "Enviar", consentText: "Aceito.", consentRequired: true },
      ],
    });
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("ytimg");
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    for (const type of ["embed", "pix", "form"]) expect(html).toContain(`data-block-type="${type}"`);
    // Pix: the key is plain text next to the button, and the external link is a user link.
    expect(html).toContain("529.982.247-25");
    expect(html).toMatch(/href="https:\/\/pagamento\.exemplo\.com\.br\/x" rel="ugc nofollow noopener noreferrer"/);
    // Form: a real form with labelled fields, a honeypot out of the tab order and a required consent box.
    expect(html).toMatch(/<form[^>]*data-block-type="form"/);
    const honeypot = /<input[^>]*name="website"[^>]*>/.exec(html)?.[0] ?? "";
    expect(honeypot).toContain('tabindex="-1"');
    expect(html).toMatch(/aria-hidden="true"><label[^>]*>Deixe este campo em branco/);
    const tag = (name: string) => new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? "";
    expect(tag("consent")).toContain("required");
    expect(tag("email")).toContain("required");
    expect(html).not.toMatch(/<textarea[^>]*required/);
  });

  it("makes the preview inert: no links, no submittable form", async () => {
    const html = await render({
      title: "Studio", bio: "", avatarPath: null, theme: null,
      blocks: [
        { id: "e", type: "embed", visible: true, provider: "spotify", ref: "track/4uLU6hMCjMI75M1A2tKUQC", title: "Ouça" },
        { id: "p", type: "pix", visible: true, label: "Pix", keyType: "cpf", key: "52998224725", paymentUrl: "https://pagamento.exemplo.com.br/x" },
        { id: "f", type: "form", visible: true, title: "Contato", fields: ["email"], buttonLabel: "Enviar", consentText: "Aceito.", consentRequired: true },
      ],
    }, false);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="submit"');
    expect(html).toContain("Na prévia, o formulário não envia dados.");
  });
});
