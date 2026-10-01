"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MEDIA_COPY } from "@/content/pt-BR";
import { readPickedImage, renderCrop, type PickedImage } from "@/modules/media/client-prepare";
import { sendUpload } from "@/modules/media/client-upload";
import type { CropState } from "@/modules/media/crop";
import { uploadErrorMessage } from "@/modules/media/messages";
import type { MediaKind } from "@/modules/media/policy";
import type { UploadedMedia } from "@/modules/media/service";
import { createUploadController, isUploadBusy, type UploadFailure } from "@/modules/media/upload-machine";
import { Button } from "@/ui";
import { CropDialog } from "./crop-dialog";

interface ImageUploaderProps {
  /** Prefix for the ids of the file input and the help text. */
  id: string;
  /** Id of the button that opens the file picker (focus returns to it). */
  pickId: string;
  profileId: string;
  kind: MediaKind;
  hasImage: boolean;
  labels: { pick: string; replace: string };
  onUploaded: (media: UploadedMedia) => void;
  /** The editor blocks publishing and warns before leaving while this is true. */
  onBusyChange: (busy: boolean) => void;
}

interface CropSource {
  image: PickedImage;
  crop: CropState;
}

/**
 * Picks, crops and uploads one image (ADR 0009): a button and a drop target, early checks with
 * specific messages, progress, cancel and retry. Status is always text in a live region. The state
 * machine is modules/media/upload-machine.ts; this component only renders it.
 */
export function ImageUploader({ id, pickId, profileId, kind, hasImage, labels, onUploaded, onBusyChange }: ImageUploaderProps) {
  const input = useRef<HTMLInputElement>(null);
  const [controller] = useState(() => createUploadController<CropSource, Blob>({
    prepare: async (source) => {
      const rendered = await renderCrop(source.image, source.crop, kind);
      return rendered.ok ? { ok: true, prepared: rendered.blob } : rendered;
    },
    send: (blob, hooks) => sendUpload(blob, { profileId, kind }, hooks),
  }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [pickError, setPickError] = useState<UploadFailure | null>(null);
  const [opening, setOpening] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const delivered = useRef<string | null>(null);
  const cropWasOpen = useRef(false);
  // Latest callbacks, so the effects below depend only on the upload itself.
  const callbacks = useRef({ onUploaded, onBusyChange });
  useEffect(() => { callbacks.current = { onUploaded, onBusyChange }; });

  const busy = opening || isUploadBusy(snapshot.phase);

  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => { callbacks.current.onBusyChange(busy); }, [busy]);
  useEffect(() => () => callbacks.current.onBusyChange(false), []);

  // When the crop dialog closes (confirmed or canceled), focus returns to the button that opened
  // the picker. Done after the dialog is gone: while it is open everything behind it is inert.
  useEffect(() => {
    if (picked) cropWasOpen.current = true;
    else if (cropWasOpen.current) {
      cropWasOpen.current = false;
      document.getElementById(pickId)?.focus();
    }
  }, [picked, pickId]);

  // Hand the finished upload to the editor exactly once.
  useEffect(() => {
    if (snapshot.phase !== "done" || !snapshot.media || delivered.current === snapshot.media.mediaId) return;
    delivered.current = snapshot.media.mediaId;
    callbacks.current.onUploaded(snapshot.media);
  }, [snapshot]);

  async function open(file: File | undefined) {
    if (!file || busy) return;
    setPickError(null);
    controller.reset();
    setOpening(true);
    const outcome = await readPickedImage(file);
    setOpening(false);
    if (outcome.ok) setPicked(outcome.image);
    else setPickError(outcome.error);
  }

  function closeCrop() {
    picked?.bitmap.close();
    setPicked(null);
  }

  function confirmCrop(crop: CropState) {
    if (!picked) return;
    const source = { image: picked, crop };
    setPicked(null);
    void controller.start(source).finally(() => source.image.bitmap.close());
  }

  const error = pickError ?? snapshot.error;
  const percent = Math.round(snapshot.progress * 100);
  const statusText = opening || snapshot.phase === "preparing" ? MEDIA_COPY.status.preparing
    : snapshot.phase === "uploading" ? MEDIA_COPY.status.uploading(percent)
    : snapshot.phase === "processing" ? MEDIA_COPY.status.processing
    : snapshot.phase === "done" ? MEDIA_COPY.status.done
    : snapshot.phase === "canceled" ? MEDIA_COPY.status.canceled
    : "";

  return (
    <div
      className={`grid gap-3 rounded-xl border border-dashed p-3 ${dragOver ? "border-app-accent bg-app-accent-soft" : "border-app-border"}`}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => { event.preventDefault(); setDragOver(false); void open(event.dataTransfer.files[0]); }}
    >
      <input
        ref={input}
        id={`${id}-file`}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => { const [file] = event.target.files ?? []; event.target.value = ""; void open(file); }}
      />
      <div className="flex flex-wrap items-center gap-3">
        {/* Stays focusable while busy (focus returns here after the crop dialog); it just does nothing then. */}
        <Button type="button" id={pickId} variant="secondary" aria-disabled={busy} aria-describedby={`${id}-help`} onClick={() => { if (!busy) input.current?.click(); }}>
          {hasImage ? labels.replace : labels.pick}
        </Button>
        <span className="text-sm text-app-muted">{MEDIA_COPY.dropHint}</span>
      </div>
      <p id={`${id}-help`} className="ui-hint">{MEDIA_COPY.accepted}</p>

      <div role="status" aria-live="polite" className="grid gap-2">
        {statusText ? <p className="m-0 font-bold">{statusText}</p> : null}
        {snapshot.phase === "uploading" || snapshot.phase === "processing" ? <progress className="h-2 w-full" max={100} value={snapshot.phase === "processing" ? 100 : percent} aria-label={statusText} /> : null}
      </div>
      {isUploadBusy(snapshot.phase) ? <div><Button type="button" variant="secondary" onClick={() => controller.cancel()}>{MEDIA_COPY.cancel}</Button></div> : null}

      {error ? (
        <div role="alert" className="grid gap-2 rounded-xl border border-app-danger/30 bg-app-danger/10 p-3">
          <p className="m-0 font-bold text-app-danger">{uploadErrorMessage(error, kind)}</p>
          {snapshot.phase === "failed" ? <div><Button type="button" variant="secondary" onClick={() => void controller.retry()}>{MEDIA_COPY.retry}</Button></div> : null}
        </div>
      ) : null}

      <CropDialog key={picked ? "open" : "closed"} image={picked} kind={kind} onConfirm={confirmCrop} onCancel={closeCrop} />
    </div>
  );
}
