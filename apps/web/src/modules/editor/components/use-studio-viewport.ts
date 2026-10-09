"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keep the editor inside the visible area when a mobile keyboard opens.
 * This is scoped to the mounted studio; it never changes the document viewport or disables zoom.
 */
export function useStudioViewport(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const studio = ref.current;
    if (!studio) return;
    const mobile = window.matchMedia("(max-width: 1023px)");
    const viewport = window.visualViewport;
    let frame = 0;
    let fullHeight = viewport?.height ?? window.innerHeight;
    let fullWidth = window.innerWidth;

    function clearKeyboardViewport() {
      if (!studio) return;
      studio.style.removeProperty("--studio-visible-height");
      studio.style.removeProperty("--studio-viewport-top");
      studio.removeAttribute("data-keyboard");
    }

    function sync() {
      if (!studio) return;
      if (!mobile.matches || (viewport && viewport.scale !== 1)) {
        clearKeyboardViewport();
        return;
      }
      const height = viewport?.height ?? window.innerHeight;
      const active = document.activeElement;
      const typing = active instanceof HTMLElement && studio.contains(active)
        && active.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="range"]):not([type="submit"]):not([type="button"])');

      // Safari may report the keyboard-sized visual viewport after the field loses focus.
      // Keep its last full height until the viewport recovers or the device rotates.
      if (!typing && (window.innerWidth !== fullWidth || height >= fullHeight - 80)) {
        fullHeight = height;
        fullWidth = window.innerWidth;
      }
      const keyboardVisible = typing && fullHeight - height > 120;
      if (!keyboardVisible) {
        clearKeyboardViewport();
        return;
      }

      studio.style.setProperty("--studio-visible-height", `${height}px`);
      studio.style.setProperty("--studio-viewport-top", `${viewport?.offsetTop ?? 0}px`);
      studio.setAttribute("data-keyboard", "");

      // Scroll only the form's own container, never the page or the preview behind it.
      const scroller = active.closest(".studio-scroll");
      if (scroller) {
        const field = active.getBoundingClientRect();
        const bounds = scroller.getBoundingClientRect();
        if (field.bottom > bounds.bottom - 16) scroller.scrollTop += field.bottom - bounds.bottom + 16;
        else if (field.top < bounds.top + 16) scroller.scrollTop += field.top - bounds.top - 16;
      }
    }

    function schedule() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(sync);
    }
    sync();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    mobile.addEventListener("change", schedule);
    studio.addEventListener("focusin", schedule);
    studio.addEventListener("focusout", schedule);
    studio.addEventListener("click", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      mobile.removeEventListener("change", schedule);
      studio.removeEventListener("focusin", schedule);
      studio.removeEventListener("focusout", schedule);
      studio.removeEventListener("click", schedule);
      clearKeyboardViewport();
    };
  }, [ref]);
}
