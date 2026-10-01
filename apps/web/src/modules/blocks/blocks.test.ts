import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_BLOCKS, MAX_BLOCKS_BYTES } from "./limits";
import { blocksByteSize, isValidStoredBlock, jsonbText, readDraftBlocks, validateStoredBlocks, type DraftBlock } from "./model";
import { MALICIOUS_URL_CASES } from "./url-cases";
import { isAllowedStoredUrl, normalizeBlockUrl } from "./url-policy";
import { blockToInput, normalizedInput, validateBlockInput } from "./validation";
import { formatWhatsAppPhone, normalizeWhatsAppPhone, whatsAppHref } from "./whatsapp";

const ID = "6f1c1d2e-0000-4000-8000-000000000001";
const ID_2 = "6f1c1d2e-0000-4000-8000-000000000002";

describe("URL policy", () => {
  it.each(MALICIOUS_URL_CASES)("refuses %s", (_label, value) => {
    expect(normalizeBlockUrl(value).ok).toBe(false);
    expect(isAllowedStoredUrl(value)).toBe(false);
  });

  it("refuses NUL (TypeScript-only case: Postgres text cannot hold it)", () => {
    expect(normalizeBlockUrl("java\u0000script:alert(1)").ok).toBe(false);
  });

  it("explains why a destination is refused", () => {
    expect(normalizeBlockUrl("javascript:alert(1)")).toEqual({ ok: false, reason: "scheme" });
    expect(normalizeBlockUrl("java\tscript:alert(1)")).toEqual({ ok: false, reason: "scheme" });
    expect(normalizeBlockUrl("%6Aavascript:alert(1)")).toEqual({ ok: false, reason: "scheme" });
    expect(normalizeBlockUrl("//evil.example")).toEqual({ ok: false, reason: "relative" });
    expect(normalizeBlockUrl("https://user:pass@exemplo.com.br")).toEqual({ ok: false, reason: "credentials" });
    expect(normalizeBlockUrl("https://exemplo.com.br/a b")).toEqual({ ok: false, reason: "whitespace" });
    expect(normalizeBlockUrl("localhost:3000")).toEqual({ ok: false, reason: "host" });
    expect(normalizeBlockUrl("   ")).toEqual({ ok: false, reason: "required" });
    expect(normalizeBlockUrl(`https://exemplo.com.br/${"a".repeat(2100)}`)).toEqual({ ok: false, reason: "too_long" });
    expect(normalizeBlockUrl("mailto:sem-arroba")).toEqual({ ok: false, reason: "email" });
    expect(normalizeBlockUrl("tel:abc")).toEqual({ ok: false, reason: "phone" });
  });

  it.each([
    ["exemplo.com.br", "https://exemplo.com.br/"],
    ["  Exemplo.COM.br/Cardapio?x=1#topo  ", "https://exemplo.com.br/Cardapio?x=1#topo"],
    ["exemplo.com.br:8080/a", "https://exemplo.com.br:8080/a"],
    ["HTTPS://exemplo.com.br", "https://exemplo.com.br/"],
    ["https://café.com.br/menu", "https://xn--caf-dma.com.br/menu"],
    ["https://exemplo.com.br/ação", "https://exemplo.com.br/a%C3%A7%C3%A3o"],
    ["MAILTO:Ana@Exemplo.COM.br?subject=Olá", "mailto:Ana@exemplo.com.br?subject=Ol%C3%A1"],
    ["tel:+55 (11) 91234-5678", "tel:+5511912345678"],
    ["https://wa.me/5511912345678", "https://wa.me/5511912345678"],
  ])("normalizes %j to %j", (input, expected) => {
    const result = normalizeBlockUrl(input);
    expect(result).toMatchObject({ ok: true, url: expected });
    expect(isAllowedStoredUrl(expected)).toBe(true);
  });

  it("keeps http as typed and flags it as insecure; flags punycode hosts", () => {
    expect(normalizeBlockUrl("http://exemplo.com.br")).toMatchObject({ ok: true, url: "http://exemplo.com.br/", insecure: true });
    expect(normalizeBlockUrl("https://café.com.br")).toMatchObject({ ok: true, punycode: true });
  });

  it("accepts only the stored (normalized) form on read", () => {
    expect(isAllowedStoredUrl("exemplo.com.br")).toBe(false);
    expect(isAllowedStoredUrl("https://EXEMPLO.com.br/")).toBe(false);
    expect(isAllowedStoredUrl(42)).toBe(false);
  });

  it("allows links to the product's own origin like any https URL (explicit rule, ADR 0008)", () => {
    expect(normalizeBlockUrl("https://projeto-lnk.example/ana")).toMatchObject({ ok: true });
  });
});

describe("WhatsApp numbers", () => {
  it.each([
    ["(11) 91234-5678", "5511912345678"],
    ["11912345678", "5511912345678"],
    ["0 11 91234-5678", "5511912345678"],
    ["+55 11 91234-5678", "5511912345678"],
    ["(21) 3333-4444", "552133334444"],
    ["+351 912 345 678", "351912345678"],
    ["00 44 7911 123456", "447911123456"],
  ])("normalizes %j to E.164 digits %s", (input, phone) => {
    expect(normalizeWhatsAppPhone(input)).toEqual({ ok: true, phone });
  });

  it.each(["", "1234", "abc", "+55 11 1234", "+55 (01) 91234-5678", "11 91234-5678 ramal 2", "+0 123456789", "1+1912345678", "+1234567890123456"])("refuses %j", (input) => {
    expect(normalizeWhatsAppPhone(input)).toEqual({ ok: false });
  });

  it("formats for display and builds wa.me at render time with an encoded message", () => {
    expect(formatWhatsAppPhone("5511912345678")).toBe("+55 (11) 91234-5678");
    expect(formatWhatsAppPhone("447911123456")).toBe("+447911123456");
    expect(whatsAppHref("5511912345678", "Olá! Quero agendar & saber o preço?")).toBe("https://wa.me/5511912345678?text=Ol%C3%A1!%20Quero%20agendar%20%26%20saber%20o%20pre%C3%A7o%3F");
    expect(whatsAppHref("5511912345678", "  ")).toBe("https://wa.me/5511912345678");
  });
});

describe("block forms", () => {
  it("normalizes a link and reports both fields when invalid", () => {
    expect(validateBlockInput(ID, true, { type: "link", title: "  Agende   já ", url: "exemplo.com.br/agenda" })).toEqual({
      ok: true, notices: {}, block: { id: ID, type: "link", visible: true, title: "Agende já", url: "https://exemplo.com.br/agenda" },
    });
    const invalid = validateBlockInput(ID, true, { type: "link", title: "x".repeat(81), url: "javascript:alert(1)" });
    expect(invalid.ok === false && Object.keys(invalid.errors).sort()).toEqual(["title", "url"]);
    expect(invalid.ok === false && invalid.errors.url).toContain("não é permitido");
  });

  it("warns about http links without blocking them", () => {
    const result = validateBlockInput(ID, true, { type: "link", title: "Site", url: "http://exemplo.com.br" });
    expect(result.ok && result.notices.url).toContain("https");
  });

  it("keeps text as plain text with line breaks and refuses control characters", () => {
    expect(validateBlockInput(ID, false, { type: "text", text: " Linha 1\r\nLinha 2 <b>não é HTML</b> " })).toMatchObject({ ok: true, block: { text: "Linha 1\nLinha 2 <b>não é HTML</b>", visible: false } });
    expect(validateBlockInput(ID, true, { type: "text", text: "a\u0007b" })).toMatchObject({ ok: false, errors: { text: expect.stringContaining("caracteres especiais") } });
    expect(validateBlockInput(ID, true, { type: "text", text: "   " }).ok).toBe(false);
    expect(validateBlockInput(ID, true, { type: "text", text: "😀".repeat(1000) }).ok).toBe(true);
    expect(validateBlockInput(ID, true, { type: "text", text: "😀".repeat(1001) }).ok).toBe(false);
  });

  it("validates WhatsApp label, number and message together", () => {
    expect(validateBlockInput(ID, true, { type: "whatsapp", label: "Fale comigo", phone: "(11) 91234-5678", message: "Oi!" })).toMatchObject({ ok: true, block: { phone: "5511912345678", message: "Oi!" } });
    const invalid = validateBlockInput(ID, true, { type: "whatsapp", label: "", phone: "123", message: "x".repeat(501) });
    expect(invalid.ok === false && Object.keys(invalid.errors).sort()).toEqual(["label", "message", "phone"]);
  });

  it("builds social items in a stable order and names the wrong network", () => {
    expect(validateBlockInput(ID, true, { type: "social", items: { tiktok: "@cafe", instagram: "cafe.ipe", youtube: " " } })).toMatchObject({
      ok: true, block: { items: [{ network: "instagram", url: "https://www.instagram.com/cafe.ipe" }, { network: "tiktok", url: "https://www.tiktok.com/@cafe" }] },
    });
    const wrong = validateBlockInput(ID, true, { type: "social", items: { instagram: "https://tiktok.com/@cafe" } });
    expect(wrong.ok === false && wrong.errors.instagram).toContain("Instagram");
    expect(validateBlockInput(ID, true, { type: "social", items: {} })).toMatchObject({ ok: true, block: { items: [] } });
  });

  it("shows normalized values back without touching invalid fields", () => {
    expect(normalizedInput({ type: "link", title: " Cardápio ", url: "exemplo.com.br" })).toEqual({ type: "link", title: "Cardápio", url: "https://exemplo.com.br/" });
    expect(normalizedInput({ type: "link", title: "", url: "javascript:x" })).toEqual({ type: "link", title: "", url: "javascript:x" });
    expect(normalizedInput({ type: "whatsapp", label: "Oi", phone: "11912345678", message: "" })).toMatchObject({ phone: "+55 (11) 91234-5678" });
  });

  it("round-trips every stored block through its form", () => {
    const blocks: DraftBlock[] = [
      { id: ID, type: "link", visible: true, title: "Site", url: "https://exemplo.com.br/" },
      { id: ID, type: "text", visible: true, text: "Olá\nmundo" },
      { id: ID, type: "social", visible: true, items: [{ network: "x", url: "https://x.com/ana" }] },
      { id: ID, type: "whatsapp", visible: false, label: "Zap", phone: "447911123456", message: "" },
      { id: ID, type: "divider", visible: true },
    ];
    for (const block of blocks) {
      expect(validateBlockInput(block.id, block.visible, blockToInput(block))).toMatchObject({ ok: true, block });
    }
  });
});

describe("stored blocks (mirror of private.validate_profile_draft)", () => {
  const valid: DraftBlock[] = [
    { id: ID, type: "link", visible: true, title: "Site", url: "https://exemplo.com.br/" },
    { id: ID_2, type: "divider", visible: false },
  ];

  it("accepts every valid type and rejects unexpected keys, bad ids and duplicates", () => {
    expect(validateStoredBlocks(valid)).toEqual({ ok: true, blocks: valid });
    expect(validateStoredBlocks([{ ...valid[0], onclick: "x" }])).toMatchObject({ ok: false, reason: "invalid_block", index: 0 });
    expect(validateStoredBlocks([{ ...valid[0], id: "b1" }])).toMatchObject({ ok: false, reason: "invalid_block" });
    expect(validateStoredBlocks([valid[0], valid[0]])).toMatchObject({ ok: false, reason: "duplicate_id", index: 1 });
    expect(validateStoredBlocks("[]")).toEqual({ ok: false, reason: "shape" });
    expect(isValidStoredBlock({ id: ID, type: "embed", visible: true })).toBe(false);
    expect(isValidStoredBlock({ id: ID, type: "whatsapp", visible: true, label: "Zap", phone: "+5511912345678", message: "" })).toBe(false);
    expect(isValidStoredBlock({ id: ID, type: "whatsapp", visible: true, label: "Zap", phone: "https://evil.example", message: "" })).toBe(false);
    expect(isValidStoredBlock({ id: ID, type: "link", visible: true, title: " não normalizado", url: "https://exemplo.com.br/" })).toBe(false);
    expect(isValidStoredBlock({ id: ID, type: "social", visible: true, items: [{ network: "x", url: "https://x.com/a" }, { network: "x", url: "https://x.com/b" }] })).toBe(false);
  });

  it("enforces the block count and the serialized size caps", () => {
    const many = Array.from({ length: MAX_BLOCKS + 1 }, (_, index) => ({ id: `6f1c1d2e-0000-4000-8000-${String(index).padStart(12, "0")}`, type: "divider" as const, visible: true }));
    expect(validateStoredBlocks(many)).toEqual({ ok: false, reason: "too_many" });
    const big = Array.from({ length: 70 }, (_, index) => ({ id: `6f1c1d2e-0000-4000-8000-${String(index).padStart(12, "0")}`, type: "text" as const, visible: true, text: "x".repeat(1000) }));
    expect(blocksByteSize(big)).toBeGreaterThan(MAX_BLOCKS_BYTES);
    expect(validateStoredBlocks(big)).toEqual({ ok: false, reason: "too_large" });
  });

  it("measures size like Postgres prints jsonb", () => {
    expect(jsonbText([{ visible: true, id: "a", type: "divider" }])).toBe('[{"id": "a", "type": "divider", "visible": true}]');
  });

  it("reads stored drafts tolerantly, keeping outdated content for the editor to flag", () => {
    const read = readDraftBlocks([
      { id: ID, type: "link", title: "Intranet", url: "https://intranet/", visible: true },
      { id: ID, type: "text", text: "duplicado", visible: true },
      { id: "x", type: "link" },
      { id: ID_2, type: "embed", visible: true },
      null,
    ]);
    expect(read).toEqual([{ id: ID, type: "link", title: "Intranet", url: "https://intranet/", visible: true }]);
    expect(isValidStoredBlock(read[0])).toBe(false);
    expect(readDraftBlocks("nope")).toEqual([]);
  });
});

describe("malicious URL table matches the pgTAP suite (drift guard)", () => {
  it("every SQL-representable case is in supabase/tests/database/100-blocks.test.sql", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../../../supabase/tests/database/100-blocks.test.sql", import.meta.url)), "utf8");
    const hexInSql = new Set([...sql.matchAll(/decode\('([0-9a-f]+)', 'hex'\)/g)].map((match) => match[1]));
    for (const [label, value] of MALICIOUS_URL_CASES) {
      expect(hexInSql.has(Buffer.from(value, "utf8").toString("hex")), label).toBe(true);
    }
  });
});
