import { CLIENT_MAX_EDGE, type ImageSize } from "./policy";

/**
 * Crop geometry (ADR 0009). Pure: the dialog only moves three numbers and draws the rectangle this
 * returns. Applied in the browser before upload; the server never receives crop parameters.
 */
export const CROP_ASPECTS = {
  original: null,
  "1:1": 1,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "4:5": 4 / 5,
} as const;

export type CropAspect = keyof typeof CROP_ASPECTS;
export const IMAGE_CROP_ASPECTS = Object.keys(CROP_ASPECTS) as CropAspect[];

export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 4;

export interface CropState {
  aspect: CropAspect;
  /** 1 shows as much of the image as the aspect allows; larger values zoom in. */
  zoom: number;
  /** Position of the crop inside the free space, 0 (left/top) to 1 (right/bottom). */
  panX: number;
  panY: number;
}

export const INITIAL_CROP: CropState = { aspect: "original", zoom: 1, panX: 0.5, panY: 0.5 };
export const AVATAR_CROP: CropState = { aspect: "1:1", zoom: 1, panX: 0.5, panY: 0.5 };

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

/** Rectangle of the source image, in source pixels, that the crop selects. Always inside the image. */
export function cropRect(source: ImageSize, crop: CropState): CropRect {
  const aspect = CROP_ASPECTS[crop.aspect] ?? source.width / source.height;
  const zoom = clamp(crop.zoom, CROP_ZOOM_MIN, CROP_ZOOM_MAX);
  // Largest rectangle of the requested aspect that fits the image, then scaled down by the zoom.
  let width = source.width;
  let height = width / aspect;
  if (height > source.height) {
    height = source.height;
    width = height * aspect;
  }
  width = Math.max(1, Math.round(width / zoom));
  height = Math.max(1, Math.round(height / zoom));
  const x = Math.round((source.width - width) * clamp(crop.panX, 0, 1));
  const y = Math.round((source.height - height) * clamp(crop.panY, 0, 1));
  return { x, y, width: Math.min(width, source.width - x), height: Math.min(height, source.height - y) };
}

/** Size the cropped area is scaled to before upload: never enlarged, long edge at most 2048 px. */
export function outputSize(rect: Pick<CropRect, "width" | "height">, maxEdge: number = CLIENT_MAX_EDGE): ImageSize {
  const scale = Math.min(1, maxEdge / Math.max(rect.width, rect.height));
  return { width: Math.max(1, Math.round(rect.width * scale)), height: Math.max(1, Math.round(rect.height * scale)) };
}
