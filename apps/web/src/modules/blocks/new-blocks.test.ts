import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMBED_FRAME_ATTRIBUTES, EMBED_PROVIDER_IDS, EMBED_PROVIDERS, embedFrameSrc, embedLayout, embedPageUrl, isValidEmbedRef, parseEmbedInput } from "./embed";
import { MALICIOUS_EMBED_CASES } from "./embed-cases";
import { isValidFormFields, orderFormFields } from "./form";
import { isAllowedPaymentUrl, isValidStoredBlock, readDraftBlocks, validateStoredBlocks, type DraftBlock } from "./model";
import { detectPixKeyType, formatPixKey, isValidCnpj, isValidCpf, isValidPixKey, normalizePixKey } from "./pix";
import { blockToInput, emptyBlockInput, normalizedInput, validateBlockInput } from "./validation";

const ID = "6f1c1d2e-0000-4000-8000-000000000001";
const MEDIA = "9a000000-0000-4000-8000-000000000001";
const SQL_TESTS = fileURLToPath(new URL("../../../../../supabase/tests/database/110-new-blocks.test.sql", import.meta.url));

describe("embed allowlist (AC4)", () => {
  it.each(MALICIOUS_EMBED_CASES)("refuses %s", (_label, value) => {
    expect(parseEmbedInput(value).ok).toBe(false);
    // The same string is never a valid id for any provider, so it cannot reach an iframe src.
    for (const provider of EMBED_PROVIDER_IDS) {
      expect(isValidEmbedRef(provider, value)).toBe(false);
      expect(embedFrameSrc(provider, value)).toBeNull();
      expect(embedPageUrl(provider, value)).toBeNull();
    }
  });

  it("explains why an input is refused", () => {
    expect(parseEmbedInput("  ")).toEqual({ ok: false, reason: "required" });
    expect(parseEmbedInput('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ">')).toEqual({ ok: false, reason: "markup" });
    expect(parseEmbedInput("javascript:alert(1)")).toEqual({ ok: false, reason: "address" });
    expect(parseEmbedInput("mailto:ana@exemplo.com.br")).toEqual({ ok: false, reason: "address" });
    expect(parseEmbedInput("https://evil.example/watch?v=dQw4w9WgXcQ")).toEqual({ ok: false, reason: "unknown_provider" });
    expect(parseEmbedInput("https://www.youtube.com/feed/trending")).toEqual({ ok: false, reason: "unrecognized" });
  });

  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["http://m.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://vimeo.com/123456789", "vimeo", "123456789"],
    ["https://player.vimeo.com/video/123456789?h=abc", "vimeo", "123456789"],
    ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=xyz", "spotify", "track/4uLU6hMCjMI75M1A2tKUQC"],
    ["https://open.spotify.com/intl-pt/album/4uLU6hMCjMI75M1A2tKUQC", "spotify", "album/4uLU6hMCjMI75M1A2tKUQC"],
    ["https://open.spotify.com/embed/playlist/4uLU6hMCjMI75M1A2tKUQC", "spotify", "playlist/4uLU6hMCjMI75M1A2tKUQC"],
  ] as const)("reads %j as %s %s", (input, provider, ref) => {
    expect(parseEmbedInput(input)).toEqual({ ok: true, provider, ref });
  });

  it("keeps only the id of a valid address that carries extra parameters or a redirect", () => {
    const parsed = parseEmbedInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42s&autoplay=1&redirect=https://evil.example/login#t=99");
    expect(parsed).toEqual({ ok: true, provider: "youtube", ref: "dQw4w9WgXcQ" });
    expect(embedFrameSrc("youtube", "dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("builds every iframe address from constants plus the validated id", () => {
    expect(embedFrameSrc("youtube", "dQw4w9WgXcQ", { autoplay: true })).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1");
    expect(embedFrameSrc("vimeo", "123456789")).toBe("https://player.vimeo.com/video/123456789?dnt=1");
    expect(embedFrameSrc("spotify", "track/4uLU6hMCjMI75M1A2tKUQC")).toBe("https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC");
    expect(embedPageUrl("vimeo", "123456789")).toBe("https://vimeo.com/123456789");
    for (const provider of EMBED_PROVIDER_IDS) {
      const host = new URL(embedFrameSrc(provider, provider === "youtube" ? "dQw4w9WgXcQ" : provider === "vimeo" ? "123456789" : "show/4uLU6hMCjMI75M1A2tKUQC") ?? "").hostname;
      expect(["www.youtube-nocookie.com", "player.vimeo.com", "open.spotify.com"]).toContain(host);
    }
  });

  it("reserves the player's space and fixes the iframe attributes", () => {
    expect(embedLayout("youtube", "dQw4w9WgXcQ")).toEqual({ kind: "video" });
    expect(embedLayout("spotify", "track/4uLU6hMCjMI75M1A2tKUQC")).toEqual({ kind: "audio", height: 152 });
    expect(embedLayout("spotify", "playlist/4uLU6hMCjMI75M1A2tKUQC")).toEqual({ kind: "audio", height: 352 });
    expect(EMBED_FRAME_ATTRIBUTES.sandbox.split(" ")).not.toContain("allow-top-navigation");
    expect(EMBED_FRAME_ATTRIBUTES.sandbox.split(" ")).not.toContain("allow-forms");
    expect(EMBED_FRAME_ATTRIBUTES.referrerPolicy).toBe("strict-origin-when-cross-origin");
  });

  it("matches the pgTAP suite and the SQL patterns (drift guard)", () => {
    const sql = readFileSync(SQL_TESTS, "utf8");
    const hexInSql = new Set([...sql.matchAll(/decode\('([0-9a-f]+)', 'hex'\)/g)].map((match) => match[1]));
    for (const [label, value] of MALICIOUS_EMBED_CASES) expect(hexInSql.has(Buffer.from(value, "utf8").toString("hex")), label).toBe(true);
    const migrations = readFileSync(fileURLToPath(new URL("../../../../../supabase/migrations/202610010002_media_themes_forms.sql", import.meta.url)), "utf8");
    const body = /create function private\.is_valid_embed_ref[\s\S]*?\$\$;/.exec(migrations)?.[0] ?? "";
    const patterns = Object.fromEntries([...body.matchAll(/when '([a-z]+)' then p_ref ~ '([^']+)'/g)].map((match) => [match[1], match[2]]));
    expect(patterns).toEqual(Object.fromEntries(EMBED_PROVIDER_IDS.map((provider) => [provider, EMBED_PROVIDERS[provider].refPattern.source.replace(/\\\//g, "/")])));
  });
});

describe("Pix keys", () => {
  it("validates CPF and CNPJ check digits", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });

  it.each([
    ["cpf", "529.982.247-25", "52998224725"],
    ["cnpj", "11.222.333/0001-81", "11222333000181"],
    ["phone", "(11) 91234-5678", "+5511912345678"],
    ["phone", "+55 11 91234-5678", "+5511912345678"],
    ["phone", "5511912345678", "+5511912345678"],
    ["phone", "011 3333-4444", "+551133334444"],
    ["email", " Ana@Exemplo.COM.br ", "ana@exemplo.com.br"],
    ["random", "123E4567-E89B-42D3-A456-426614174000", "123e4567-e89b-42d3-a456-426614174000"],
  ] as const)("normalizes a %s key %j", (type, input, key) => {
    expect(normalizePixKey(type, input)).toBe(key);
    expect(isValidPixKey(type, key)).toBe(true);
  });

  it.each([
    ["cpf", "529.982.247-24"], ["cpf", "abc"], ["cnpj", "11.222.333/0001-82"], ["phone", "+1 202 555 0100"], ["phone", "1234"], ["phone", "+55 (01) 91234-5678"], ["phone", "11 91234-5678 ramal 2"],
    ["email", "ana@"], ["email", "ana exemplo@x.com"], ["email", `${"a".repeat(70)}@exemplo.com.br`], ["random", "not-a-uuid"], ["random", "<script>alert(1)</script>"],
  ] as const)("refuses %s key %j", (type, input) => {
    expect(normalizePixKey(type, input)).toBeNull();
  });

  it("accepts only the stored form on read", () => {
    expect(isValidPixKey("cpf", "529.982.247-25")).toBe(false);
    expect(isValidPixKey("phone", "5511912345678")).toBe(false);
    expect(isValidPixKey("email", "Ana@exemplo.com.br")).toBe(false);
    expect(isValidPixKey("bitcoin", "x")).toBe(false);
    expect(isValidPixKey("cpf", 52998224725)).toBe(false);
  });

  it("detects the type from what was typed", () => {
    expect(detectPixKeyType("ana@exemplo.com.br")).toBe("email");
    expect(detectPixKeyType("123e4567-e89b-42d3-a456-426614174000")).toBe("random");
    expect(detectPixKeyType("529.982.247-25")).toBe("cpf");
    expect(detectPixKeyType("11.222.333/0001-81")).toBe("cnpj");
    // Eleven digits that are not a CPF are read as a mobile number with area code.
    expect(detectPixKeyType("11912345678")).toBe("phone");
    expect(detectPixKeyType("+5511912345678")).toBe("phone");
    expect(detectPixKeyType("123")).toBeNull();
    expect(detectPixKeyType("")).toBeNull();
  });

  it("formats keys for reading without changing what is copied", () => {
    expect(formatPixKey("cpf", "52998224725")).toBe("529.982.247-25");
    expect(formatPixKey("cnpj", "11222333000181")).toBe("11.222.333/0001-81");
    expect(formatPixKey("phone", "+5511912345678")).toBe("+55 (11) 91234-5678");
    expect(formatPixKey("email", "ana@exemplo.com.br")).toBe("ana@exemplo.com.br");
  });

  it("accepts only https payment links", () => {
    expect(isAllowedPaymentUrl("")).toBe(true);
    expect(isAllowedPaymentUrl("https://pagamento.exemplo.com.br/abc")).toBe(true);
    expect(isAllowedPaymentUrl("http://pagamento.exemplo.com.br/abc")).toBe(false);
    expect(isAllowedPaymentUrl("mailto:ana@exemplo.com.br")).toBe(false);
    expect(isAllowedPaymentUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("form definition", () => {
  it("keeps the catalog order and needs a way to answer", () => {
    expect(orderFormFields(["message", "name", "email", "name"])).toEqual(["name", "email", "message"]);
    expect(isValidFormFields(["name", "email"])).toBe(true);
    expect(isValidFormFields(["phone"])).toBe(true);
    expect(isValidFormFields(["name", "message"])).toBe(false);
    expect(isValidFormFields(["email", "name"])).toBe(false);
    expect(isValidFormFields(["email", "email"])).toBe(false);
    expect(isValidFormFields(["email", "cpf"])).toBe(false);
    expect(isValidFormFields([])).toBe(false);
    expect(isValidFormFields("email")).toBe(false);
  });
});

describe("new block forms", () => {
  it("needs an uploaded image and a description (or the decorative mark)", () => {
    const empty = validateBlockInput(ID, true, emptyBlockInput("image"));
    expect(empty.ok === false && Object.keys(empty.errors).sort()).toEqual(["alt", "image"]);
    expect(validateBlockInput(ID, true, { type: "image", mediaId: MEDIA, width: 1344, height: 1008, alt: "  Fachada   do café ", decorative: false })).toEqual({
      ok: true, notices: {}, block: { id: ID, type: "image", visible: true, mediaId: MEDIA, width: 1344, height: 1008, alt: "Fachada do café", decorative: false },
    });
    expect(validateBlockInput(ID, true, { type: "image", mediaId: MEDIA, width: 448, height: 448, alt: "ignorado", decorative: true })).toMatchObject({ ok: true, block: { alt: "", decorative: true } });
    expect(validateBlockInput(ID, true, { type: "image", mediaId: MEDIA, width: 448, height: 448, alt: "x".repeat(201), decorative: false }).ok).toBe(false);
    expect(validateBlockInput(ID, true, { type: "image", mediaId: "../etc/passwd", width: 448, height: 448, alt: "x", decorative: false }).ok).toBe(false);
  });

  it("stores provider and id for an embed and says which provider was recognized", () => {
    const result = validateBlockInput(ID, true, { type: "embed", url: "youtu.be/dQw4w9WgXcQ?t=10", title: " Conheça  o estúdio " });
    expect(result).toMatchObject({ ok: true, block: { type: "embed", provider: "youtube", ref: "dQw4w9WgXcQ", title: "Conheça o estúdio" } });
    expect(result.ok && result.notices.url).toContain("YouTube");
    const refused = validateBlockInput(ID, true, { type: "embed", url: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>', title: "" });
    expect(refused.ok === false && refused.errors.url).toContain("incorporação");
    expect(refused.ok === false && refused.errors.title).toBeTruthy();
    expect(normalizedInput({ type: "embed", url: "youtu.be/dQw4w9WgXcQ?t=10", title: "Vídeo" })).toEqual({ type: "embed", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Vídeo" });
  });

  it("keeps HTML typed in text fields as plain text (it is never interpreted)", () => {
    const html = '<img src=x onerror="alert(1)">';
    expect(validateBlockInput(ID, true, { type: "embed", url: "https://vimeo.com/123456789", title: html })).toMatchObject({ ok: true, block: { title: html } });
    expect(validateBlockInput(ID, true, { type: "pix", label: html, keyType: "auto", key: "ana@exemplo.com.br", paymentUrl: "" })).toMatchObject({ ok: true, block: { label: html } });
    expect(validateBlockInput(ID, true, { type: "form", title: html, fields: ["email"], buttonLabel: "<b>Enviar</b>", consentText: "<script>alert(1)</script>", consentRequired: true })).toMatchObject({
      ok: true, block: { title: html, buttonLabel: "<b>Enviar</b>", consentText: "<script>alert(1)</script>" },
    });
    expect(validateBlockInput(ID, true, { type: "image", mediaId: MEDIA, width: 448, height: 448, alt: html, decorative: false })).toMatchObject({ ok: true, block: { alt: html } });
  });

  it("detects or checks the Pix key type and normalizes the key", () => {
    expect(validateBlockInput(ID, true, { type: "pix", label: "Pague com Pix", keyType: "auto", key: "529.982.247-25", paymentUrl: "pagamento.exemplo.com.br/x" })).toMatchObject({
      ok: true, block: { keyType: "cpf", key: "52998224725", paymentUrl: "https://pagamento.exemplo.com.br/x" },
    });
    const personal = validateBlockInput(ID, true, { type: "pix", label: "Pix", keyType: "auto", key: "(11) 91234-5678", paymentUrl: "" });
    expect(personal.ok && personal.notices.key).toContain("chave aleatória");
    const wrongType = validateBlockInput(ID, true, { type: "pix", label: "Pix", keyType: "cnpj", key: "529.982.247-25", paymentUrl: "" });
    expect(wrongType.ok === false && wrongType.errors.key).toContain("CNPJ");
    const invalid = validateBlockInput(ID, true, { type: "pix", label: "", keyType: "auto", key: "", paymentUrl: "http://pagamento.exemplo.com.br" });
    expect(invalid.ok === false && Object.keys(invalid.errors).sort()).toEqual(["key", "label", "paymentUrl"]);
    expect(validateBlockInput(ID, true, { type: "pix", label: "Pix", keyType: "auto", key: "ana@exemplo.com.br", paymentUrl: "javascript:alert(1)" }).ok).toBe(false);
  });

  it("validates the form definition and orders its fields", () => {
    expect(validateBlockInput(ID, true, { type: "form", title: "Peça um orçamento", fields: ["message", "email", "name"], buttonLabel: "Enviar", consentText: "Aceito ser contatado.", consentRequired: false })).toMatchObject({
      ok: true, block: { fields: ["name", "email", "message"], consentRequired: false },
    });
    const invalid = validateBlockInput(ID, true, { type: "form", title: "", fields: ["name"], buttonLabel: "x".repeat(41), consentText: "", consentRequired: true });
    expect(invalid.ok === false && Object.keys(invalid.errors).sort()).toEqual(["buttonLabel", "consentText", "fields", "title"]);
  });

  it("round-trips every stored block through its form", () => {
    const blocks: DraftBlock[] = [
      { id: ID, type: "image", visible: true, mediaId: MEDIA, width: 896, height: 672, alt: "Vitrine", decorative: false },
      { id: ID, type: "embed", visible: true, provider: "spotify", ref: "track/4uLU6hMCjMI75M1A2tKUQC", title: "Ouça" },
      { id: ID, type: "pix", visible: false, label: "Pix", keyType: "phone", key: "+5511912345678", paymentUrl: "" },
      { id: ID, type: "pix", visible: true, label: "Pix", keyType: "cnpj", key: "11222333000181", paymentUrl: "https://pagamento.exemplo.com.br/" },
      { id: ID, type: "form", visible: true, title: "Lista VIP", fields: ["name", "phone"], buttonLabel: "Entrar", consentText: "Aceito.", consentRequired: true },
    ];
    for (const block of blocks) {
      expect(isValidStoredBlock(block)).toBe(true);
      expect(validateBlockInput(block.id, block.visible, blockToInput(block))).toMatchObject({ ok: true, block });
    }
    expect(validateStoredBlocks(blocks.map((block, index) => ({ ...block, id: `6f1c1d2e-0000-4000-8000-00000000000${index}` })))).toMatchObject({ ok: true });
  });
});

describe("stored blocks (mirror of private.validate_profile_draft, new types)", () => {
  const image = { id: ID, type: "image", visible: true, mediaId: MEDIA, width: 896, height: 672, alt: "Vitrine", decorative: false };
  const embed = { id: ID, type: "embed", visible: true, provider: "youtube", ref: "dQw4w9WgXcQ", title: "Vídeo" };
  const pix = { id: ID, type: "pix", visible: true, label: "Pix", keyType: "email", key: "ana@exemplo.com.br", paymentUrl: "" };
  const form = { id: ID, type: "form", visible: true, title: "Contato", fields: ["email"], buttonLabel: "Enviar", consentText: "Aceito.", consentRequired: true };

  it("rejects forged payloads for every new type", () => {
    const forged: unknown[] = [
      { ...image, src: "https://evil.example/x.png" },
      { ...image, mediaId: "https://evil.example/x.png" },
      { ...image, width: 0 },
      { ...image, width: 99999 },
      { ...image, width: "896" },
      { ...image, alt: "" },
      { ...image, decorative: true },
      { ...embed, provider: "evil" },
      { ...embed, ref: "dQw4w9WgXcQ?autoplay=1" },
      { ...embed, ref: "https://evil.example" },
      { ...embed, html: "<script>" },
      { ...embed, provider: "vimeo" },
      { ...pix, key: "Ana@exemplo.com.br" },
      { ...pix, keyType: "cpf" },
      { ...pix, paymentUrl: "javascript:alert(1)" },
      { ...pix, paymentUrl: "http://exemplo.com.br/" },
      { ...form, fields: ["name"] },
      { ...form, fields: ["email", "cpf"] },
      { ...form, fields: "email" },
      { ...form, consentRequired: "true" },
      { ...form, consentText: "" },
      { ...form, action: "https://evil.example" },
    ];
    for (const block of forged) expect(isValidStoredBlock(block), JSON.stringify(block)).toBe(false);
    for (const block of [image, embed, pix, form]) expect(isValidStoredBlock(block), block.type).toBe(true);
  });

  it("reads stored drafts tolerantly for the new types", () => {
    const read = readDraftBlocks([
      { id: ID, type: "embed", provider: "evil", ref: "x", title: "y", visible: true },
      { id: "6f1c1d2e-0000-4000-8000-000000000002", type: "form", title: "Contato", fields: ["email", "cpf"], buttonLabel: "Enviar", consentText: "Aceito.", visible: true },
      { id: "6f1c1d2e-0000-4000-8000-000000000003", type: "image", mediaId: MEDIA, width: 448, height: 336, alt: "Foto", visible: true },
    ]);
    expect(read.map((block) => block.type)).toEqual(["form", "image"]);
    expect(read[0]).toMatchObject({ fields: ["email"], consentRequired: true });
    expect(read[1]).toMatchObject({ decorative: false, width: 448 });
  });
});
