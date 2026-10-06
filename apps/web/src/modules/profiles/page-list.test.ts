import { describe, expect, it } from "vitest";
import type { DraftBlock } from "@/modules/blocks";
import { TITLE_MAX_LENGTH } from "./content";
import { copyReviewKinds, needsCopyReview } from "./copy-review";
import { copySlug, copyTitle } from "./duplicate-naming";
import { hasActiveFilters, PAGE_LIST_SIZE, pageListHref, pageListOffset, pageListPageCount, parsePageListParams, readPageListItems, readPageListRow } from "./page-list";
import { SLUG_MAX_LENGTH, validateSlug } from "./slug";

const WS = "11111111-1111-4111-8111-111111111111";
const PAGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("page list parameters (untrusted query string)", () => {
  it("defaults to the plain list", () => {
    expect(parsePageListParams({})).toEqual({ search: "", slugSearch: "", status: null, order: "recent", page: 1 });
  });

  it("reads search, filter, order and page", () => {
    expect(parsePageListParams({ q: "  Café   Ipê ", situacao: "publicada", ordem: "nome", pagina: "3" }))
      .toEqual({ search: "Café Ipê", slugSearch: "cafe-ipe", status: "published", order: "name", page: 3 });
    expect(parsePageListParams({ situacao: "rascunho" }).status).toBe("draft");
    expect(parsePageListParams({ situacao: "arquivada" }).status).toBe("archived");
  });

  const unexpected: [Record<string, string | string[]>, "status" | "order" | "page", unknown][] = [
    [{ situacao: "published" }, "status", null],
    [{ situacao: "toString" }, "status", null],
    [{ situacao: "__proto__" }, "status", null],
    [{ situacao: ["arquivada", "publicada"] }, "status", "archived"],
    [{ ordem: "updated_at desc; drop table profiles" }, "order", "recent"],
    [{ pagina: "0" }, "page", 1],
    [{ pagina: "-2" }, "page", 1],
    [{ pagina: "1e3" }, "page", 1],
    [{ pagina: "2.5" }, "page", 1],
    [{ pagina: "99999" }, "page", 1],
    [{ pagina: "9999" }, "page", 500],
    [{ pagina: " 2" }, "page", 1],
  ];
  it.each(unexpected)("falls back on unexpected input %j", (query, key, expected) => {
    expect(parsePageListParams(query)[key]).toBe(expected);
  });

  it("keeps hostile search strings as plain, bounded text", () => {
    expect(parsePageListParams({ q: "%_\\" })).toMatchObject({ search: "%_\\", slugSearch: "" });
    expect(parsePageListParams({ q: "'; drop table profiles; --" })).toMatchObject({ search: "'; drop table profiles; --", slugSearch: "drop-table-profiles" });
    expect(parsePageListParams({ q: "a\u0000b\tc\nd" }).search).toBe("a b c d");
    expect(parsePageListParams({ q: "x".repeat(500) }).search).toHaveLength(80);
    expect([...parsePageListParams({ q: "😀".repeat(200) }).search]).toHaveLength(80);
    expect(parsePageListParams({ q: ["um", "dois"] }).search).toBe("um");
    expect(parsePageListParams({ q: "   " }).search).toBe("");
  });

  it("computes offset and page count from the fixed page size", () => {
    expect(pageListOffset({ page: 1 })).toBe(0);
    expect(pageListOffset({ page: 3 })).toBe(2 * PAGE_LIST_SIZE);
    expect(pageListPageCount(0)).toBe(1);
    expect(pageListPageCount(PAGE_LIST_SIZE)).toBe(1);
    expect(pageListPageCount(PAGE_LIST_SIZE + 1)).toBe(2);
  });

  it("builds links that keep the state and leave defaults out", () => {
    expect(pageListHref(WS)).toBe(`/app/w/${WS}`);
    expect(pageListHref(WS, { search: "", status: null, order: "recent", page: 1 })).toBe(`/app/w/${WS}`);
    expect(pageListHref(WS, { search: "Café & Cia", status: "archived", order: "name", page: 2 })).toBe(`/app/w/${WS}?q=Caf%C3%A9+%26+Cia&situacao=arquivada&ordem=nome&pagina=2`);
    const roundTrip = parsePageListParams(Object.fromEntries(new URL(pageListHref(WS, { search: "100% natural_loja", status: "draft", page: 4 }), "https://x.test").searchParams));
    expect(roundTrip).toMatchObject({ search: "100% natural_loja", status: "draft", page: 4 });
  });

  it("knows when there is something to clear", () => {
    expect(hasActiveFilters({ search: "", status: null })).toBe(false);
    expect(hasActiveFilters({ search: "a", status: null })).toBe(true);
    expect(hasActiveFilters({ search: "", status: "draft" })).toBe(true);
  });
});

describe("page list rows (tolerant read)", () => {
  const item = { id: PAGE, title: "Café Ipê", slug: "cafe-ipe", status: "published", avatarPath: null, publishedAt: "2026-10-01T00:00:00Z", createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", hasUnpublishedChanges: true };

  it("reads a well-formed row", () => {
    expect(readPageListRow({ total_pages: 3, draft_pages: 1, published_pages: 1, archived_pages: 1, matched_pages: 1, items: [item] }))
      .toEqual({ total: 3, counts: { draft: 1, published: 1, archived: 1 }, matched: 1, items: [item], searchable: true });
  });

  it("drops malformed items and never invents numbers", () => {
    expect(readPageListItems([item, null, "x", { ...item, id: "nope" }, { ...item, status: "deleted" }, { ...item, title: 1 }, { ...item, createdAt: null }])).toEqual([item]);
    expect(readPageListItems({ length: 1, 0: item })).toEqual([]);
    expect(readPageListRow(null)).toEqual({ total: 0, counts: { draft: 0, published: 0, archived: 0 }, matched: 0, items: [], searchable: true });
    expect(readPageListRow({ total_pages: "3", draft_pages: -1, published_pages: 1.5, archived_pages: null, matched_pages: undefined, items: "[]" }))
      .toMatchObject({ total: 0, counts: { draft: 0, published: 0, archived: 0 }, matched: 0, items: [] });
  });

  it("reads optional fields defensively", () => {
    expect(readPageListItems([{ ...item, avatarPath: 5, publishedAt: 7, hasUnpublishedChanges: "true" }])[0]).toMatchObject({ avatarPath: null, publishedAt: null, hasUnpublishedChanges: false });
  });
});

describe("duplicate naming", () => {
  it("prefixes the name and stays within the limit", () => {
    expect(copyTitle("Café Ipê")).toBe("Cópia de Café Ipê");
    expect(copyTitle("  Café   Ipê ")).toBe("Cópia de Café Ipê");
    expect([...copyTitle("x".repeat(80))]).toHaveLength(TITLE_MAX_LENGTH);
    expect([...copyTitle("😀".repeat(80))]).toHaveLength(TITLE_MAX_LENGTH);
    expect(copyTitle(`${"x".repeat(70)} y`)).not.toMatch(/\s$/);
  });

  it("suggests a valid address", () => {
    expect(copySlug("cafe-ipe")).toBe("cafe-ipe-copia");
    expect(copySlug("Café Ipê")).toBe("cafe-ipe-copia");
    expect(validateSlug(copySlug("cafe-ipe")).valid).toBe(true);
  });

  it("skips addresses already used in the workspace", () => {
    expect(copySlug("cafe-ipe", ["cafe-ipe-copia"])).toBe("cafe-ipe-copia-2");
    expect(copySlug("cafe-ipe", ["cafe-ipe-copia", "Cafe-Ipe-Copia-2", "cafe-ipe-copia-3"])).toBe("cafe-ipe-copia-4");
  });

  it("stays within the length limit and never ends the base with a hyphen", () => {
    const long = "a".repeat(SLUG_MAX_LENGTH);
    expect(copySlug(long)).toHaveLength(SLUG_MAX_LENGTH);
    expect(copySlug(long).endsWith("-copia")).toBe(true);
    expect(copySlug(long, [copySlug(long)])).toHaveLength(SLUG_MAX_LENGTH);
    expect(copySlug(`${"a".repeat(33)}-bcdefg`)).toBe(`${"a".repeat(33)}-copia`);
    expect(validateSlug(copySlug(long, [copySlug(long)])).valid).toBe(true);
  });

  it("gives up with a bounded number of attempts", () => {
    const taken = ["x-y-copia", ...Array.from({ length: 60 }, (_value, index) => `x-y-copia-${index + 2}`)];
    expect(copySlug("x-y", taken)).toBe("x-y-copia-50");
  });
});

describe("copy review notice", () => {
  const base = { id: PAGE, visible: true };
  const blocks: DraftBlock[] = [
    { ...base, type: "link", title: "Site", url: "https://example.com/" },
    { ...base, type: "form", title: "Contato", fields: ["name", "email"], buttonLabel: "Enviar", consentText: "Aceito", consentRequired: true },
    { ...base, type: "pix", label: "Pix", keyType: "random", key: "123e4567-e89b-42d3-a456-426614174000", paymentUrl: "https://pag.example.com/x" },
    { ...base, visible: false, type: "whatsapp", label: "WhatsApp", phone: "5511987654321", message: "" },
  ];

  it("lists the contact and payment details a draft contains, hidden blocks included, in a fixed order", () => {
    expect(copyReviewKinds(blocks)).toEqual(["whatsapp", "pix_key", "payment_link", "form_consent"]);
    expect(copyReviewKinds(blocks.slice(0, 1))).toEqual([]);
    expect(copyReviewKinds([{ ...base, type: "pix", label: "Pix", keyType: "random", key: "k", paymentUrl: "" }])).toEqual(["pix_key"]);
  });

  it("asks for a review only on a copy that was never published", () => {
    expect(needsCopyReview({ duplicatedFrom: PAGE, publicationCount: 0 })).toBe(true);
    expect(needsCopyReview({ duplicatedFrom: PAGE, publicationCount: 1 })).toBe(false);
    expect(needsCopyReview({ duplicatedFrom: null, publicationCount: 0 })).toBe(false);
  });
});
