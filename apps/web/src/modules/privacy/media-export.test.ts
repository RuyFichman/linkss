import { describe, expect, it } from "vitest";
import { exportMediaFiles } from "./media-export";

const WS = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const asset = { id: ID, workspace_id: WS, status: "ready", variants: [{ w: 448, h: 300, bytes: 100 }] };

describe("owner media export inventory", () => {
  it("exports each stored variant once, independent of publication or duplication references", () => {
    expect(exportMediaFiles({ mediaAssets: [{ ...asset, variants: [...asset.variants, { w: 896, h: 600, bytes: 200 }] }] }, WS))
      .toEqual([
        { mediaId: ID, width: 448, height: 300, bytes: 100, key: `${ID}/448.webp` },
        { mediaId: ID, width: 896, height: 600, bytes: 200, key: `${ID}/896.webp` },
      ]);
  });
  it("handles an empty account and excludes unfinished or deleting uploads", () => {
    expect(exportMediaFiles({ mediaAssets: [] }, WS)).toEqual([]);
    for (const status of ["pending", "failed", "deleting"]) expect(exportMediaFiles({ mediaAssets: [{ ...asset, status }] }, WS)).toEqual([]);
  });
  it.each([
    null, {}, { mediaAssets: [null] },
    { mediaAssets: [{ ...asset, workspace_id: ID }] },
    { mediaAssets: [{ ...asset, id: "../../private" }] },
    { mediaAssets: [{ ...asset, variants: [{ w: "448", h: 300, bytes: 100 }] }] },
    { mediaAssets: [{ ...asset, variants: [{ w: 448, h: 300, bytes: 3 * 1024 * 1024 }] }] },
    { mediaAssets: [{ ...asset, variants: [{ w: 0, h: 300, bytes: 100 }] }] },
  ])("fails closed for an invalid or cross-workspace inventory: %j", (input) => {
    expect(() => exportMediaFiles(input, WS)).toThrow();
  });
});
