"use client";

import { useEffect, useRef, useState } from "react";
import { MEDIA_COPY } from "@/content/pt-BR";
import { drawCrop, type PickedImage } from "@/modules/media/client-prepare";
import { AVATAR_CROP, CROP_ZOOM_MAX, CROP_ZOOM_MIN, cropRect, IMAGE_CROP_ASPECTS, INITIAL_CROP, outputSize, type CropState } from "@/modules/media/crop";
import type { MediaKind } from "@/modules/media/policy";
import { Button, Dialog, DialogActions } from "@/ui";

const PREVIEW_EDGE = 320;

interface CropDialogProps {
  image: PickedImage | null;
  kind: MediaKind;
  onConfirm: (crop: CropState) => void;
  onCancel: () => void;
}

/**
 * Crop before upload (ADR 0009). Three range inputs do everything (zoom, horizontal, vertical), so
 * the dialog works with a keyboard, touch or a pointer; dragging the preview is an extra. The
 * geometry lives in modules/media/crop.ts; this component only moves the numbers.
 */
export function CropDialog({ image, kind, onConfirm, onCancel }: CropDialogProps) {
  const [crop, setCrop] = useState<CropState>(kind === "avatar" ? AVATAR_CROP : INITIAL_CROP);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const rect = image ? cropRect(image.size, crop) : null;
  const freeX = image && rect ? image.size.width - rect.width : 0;
  const freeY = image && rect ? image.size.height - rect.height : 0;

  useEffect(() => {
    if (!image || !canvas.current) return;
    const selection = cropRect(image.size, crop);
    drawCrop(canvas.current, image, selection, outputSize(selection, PREVIEW_EDGE), false);
  }, [image, crop]);

  function update(patch: Partial<CropState>) {
    setCrop((current) => ({ ...current, ...patch }));
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const start = drag.current;
    const element = canvas.current;
    if (!start || !element || !rect) return;
    // Moving the picture right shows what is further left: the selection moves the other way.
    const scaleX = rect.width / element.clientWidth;
    const scaleY = rect.height / element.clientHeight;
    update({
      panX: freeX > 0 ? Math.min(1, Math.max(0, start.panX - ((event.clientX - start.x) * scaleX) / freeX)) : start.panX,
      panY: freeY > 0 ? Math.min(1, Math.max(0, start.panY - ((event.clientY - start.y) * scaleY) / freeY)) : start.panY,
    });
  }

  return (
    <Dialog open={image !== null} onClose={onCancel} title={kind === "avatar" ? MEDIA_COPY.crop.avatarTitle : MEDIA_COPY.crop.title}>
      <div className="grid gap-4">
        <p className="m-0 text-app-muted">{MEDIA_COPY.crop.lead}</p>
        <div className="grid place-items-center rounded-xl bg-app-surface-soft p-3">
          <canvas
            ref={canvas}
            role="img"
            aria-label={MEDIA_COPY.crop.preview}
            className={`max-h-[45vh] max-w-full touch-none ${freeX > 0 || freeY > 0 ? "cursor-grab" : ""} ${kind === "avatar" ? "rounded-full" : "rounded-lg"}`}
            onPointerDown={(event) => {
              drag.current = { x: event.clientX, y: event.clientY, panX: crop.panX, panY: crop.panY };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={onPointerMove}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
          />
        </div>

        {kind === "image" ? (
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="ui-label mb-2 p-0">{MEDIA_COPY.crop.aspect}</legend>
            <div className="flex flex-wrap gap-2">
              {IMAGE_CROP_ASPECTS.map((aspect) => (
                <label key={aspect} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 ${crop.aspect === aspect ? "border-app-accent bg-app-accent-soft font-bold" : "border-app-border"}`}>
                  <input type="radio" name="crop-aspect" value={aspect} checked={crop.aspect === aspect} onChange={() => update({ aspect })} />
                  {MEDIA_COPY.crop.aspects[aspect]}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="grid gap-3">
          <div className="ui-field">
            <label htmlFor="crop-zoom">{MEDIA_COPY.crop.zoom}</label>
            <input id="crop-zoom" className="min-h-11 w-full" type="range" min={CROP_ZOOM_MIN} max={CROP_ZOOM_MAX} step={0.05} value={crop.zoom} onChange={(event) => update({ zoom: Number(event.target.value) })} />
          </div>
          <div className="ui-field">
            <label htmlFor="crop-x">{MEDIA_COPY.crop.horizontal}</label>
            <input id="crop-x" className="min-h-11 w-full" type="range" min={0} max={1} step={0.01} value={crop.panX} disabled={freeX <= 0} onChange={(event) => update({ panX: Number(event.target.value) })} />
          </div>
          <div className="ui-field">
            <label htmlFor="crop-y">{MEDIA_COPY.crop.vertical}</label>
            <input id="crop-y" className="min-h-11 w-full" type="range" min={0} max={1} step={0.01} value={crop.panY} disabled={freeY <= 0} onChange={(event) => update({ panY: Number(event.target.value) })} />
          </div>
        </div>
      </div>
      <DialogActions>
        <Button type="button" variant="secondary" onClick={onCancel}>{MEDIA_COPY.crop.cancel}</Button>
        <Button type="button" onClick={() => onConfirm(crop)}>{MEDIA_COPY.crop.confirm}</Button>
      </DialogActions>
    </Dialog>
  );
}
