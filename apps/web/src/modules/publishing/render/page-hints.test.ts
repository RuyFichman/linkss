import { describe, expect, it } from "vitest";
import { imageSources } from "@/modules/media/url";
import { CLASSIC_THEME } from "@/modules/themes/resolve";
import { parsePublishedDocument, type PublishedDocument } from "../document";
import { pageChromeColor, priorityImagePreload, publicPageViewport } from "./page-hints";

const MEDIA = "0b6f5f0a-58c4-4e0f-9d7e-2a1c0c1d2e3f";
const image = { id: "img", type: "image", mediaId: MEDIA, width: 896, height: 672, alt: "" };
const link = (id: string) => ({ id, type: "link", title: "Site", url: "https://exemplo.com.br/" });

function document(blocks: unknown[], theme: unknown = null): PublishedDocument {
  const parsed = parsePublishedDocument({ schemaVersion: 2, title: "Studio", bio: "", avatarPath: null, theme, blocks });
  if (!parsed) throw new Error("fixture");
  return parsed;
}

describe("browser bar color of a public page", () => {
  it("is the page's own background, as a plain hex color", () => {
    expect(pageChromeColor(document([]))).toBe(CLASSIC_THEME.pageBackground.toLowerCase());
    const dark = document([], { background: "#101418", button: "#ffd166", buttonStyle: "filled", corners: "rounded", spacing: "regular", font: "system" });
    expect(dark.theme).not.toBeNull();
    expect(pageChromeColor(dark)).toBe("#101418");
    expect(pageChromeColor(dark)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("is declared as theme-color only for a page on the air", () => {
    const doc = document([]);
    expect(publicPageViewport({ state: "published", slug: "studio", document: doc, version: 1, publishedAt: "2026-10-11T00:00:00Z", showBadge: true, customDomain: null, pixels: null } as never)).toEqual({ themeColor: pageChromeColor(doc) });
    for (const state of ["not_found", "unpublished", "suspended"] as const) expect(publicPageViewport({ state } as never)).toEqual({});
  });
});

describe("preload of the first image", () => {
  it("names the same sources the renderer gives the image", () => {
    expect(priorityImagePreload(document([link("a"), image, link("b")]))).toEqual(imageSources(MEDIA, 896));
  });

  it("is absent when no image is among the leading blocks", () => {
    expect(priorityImagePreload(document([link("a"), link("b")]))).toBeNull();
    expect(priorityImagePreload(document([link("a"), link("b"), link("c"), image]))).toBeNull();
    expect(priorityImagePreload(document([]))).toBeNull();
  });
});
