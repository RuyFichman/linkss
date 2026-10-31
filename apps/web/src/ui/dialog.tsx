"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { UI_COPY } from "@/content/localized";
import { IconButton } from "./button";
import { useCopy } from "./locale-context";

interface DialogProps { children: ReactNode; open: boolean; onClose: () => void; title: string; closeLabel?: string; }
export function Dialog({ children, open, onClose, title, closeLabel: givenCloseLabel }: DialogProps) {
  const words = useCopy(UI_COPY);
  const closeLabel = givenCloseLabel ?? words.closeWindow;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) { triggerRef.current = document.activeElement as HTMLElement | null; dialog.showModal(); }
    else if (!open && dialog.open) { dialog.close(); triggerRef.current?.focus(); }
  }, [open]);
  return <dialog ref={dialogRef} className="ui-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); triggerRef.current?.focus(); }}><div className="mb-5 flex items-start justify-between gap-4"><h2 className="text-2xl font-bold" id={titleId}>{title}</h2><IconButton label={closeLabel} onClick={onClose}>×</IconButton></div>{children}</dialog>;
}
export const Sheet = Dialog;
export function DialogActions({ children }: { children: ReactNode }) { return <div className="mt-6 flex flex-wrap justify-end gap-3">{children}</div>; }
