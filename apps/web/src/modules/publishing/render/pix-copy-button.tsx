"use client";

import { useState } from "react";
import { PUBLIC_PAGE_COPY } from "@/content/pt-BR";

/**
 * Copies the Pix key. An enhancement only: the key next to it is plain, selectable text, so the
 * block is still usable when scripts are blocked or the clipboard is not available.
 */
export function PixCopyButton({ value, className, disabled = false }: { value: string; className: string; disabled?: boolean }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => void copy()}>{PUBLIC_PAGE_COPY.pix.copy}</button>
      <span role="status" aria-live="polite" className="min-h-5 text-sm font-bold">
        {status === "copied" ? PUBLIC_PAGE_COPY.pix.copied : status === "failed" ? PUBLIC_PAGE_COPY.pix.copyFailed : ""}
      </span>
    </>
  );
}
