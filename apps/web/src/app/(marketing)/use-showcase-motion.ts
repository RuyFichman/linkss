"use client";

import { useEffect, useRef } from "react";
import { advanceShowcase, dragIntent, loopOffset } from "./showcase-motion";

type PointerDrag = { id: number; x: number; y: number; offset: number; intent: ReturnType<typeof dragIntent> };

/** Native scrolling remains available; animation and pointer dragging share one loop coordinate. */
export function useShowcaseMotion(count: number, running: boolean) {
  const railRef = useRef<HTMLUListElement>(null);
  const runningRef = useRef(running);
  const refreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    runningRef.current = running;
    refreshRef.current?.();
  }, [running]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || count < 2) return;
    let cycle = 0;
    let position = 0;
    let lastWritten = 0;
    let previousTime: number | null = null;
    let frame: number | null = null;
    let visible = false;
    let keyboardFocus = false;
    let pointer: PointerDrag | null = null;
    let suppressClick = false;

    function writePosition(offset: number) {
      position = offset;
      rail!.scrollLeft = offset;
      lastWritten = rail!.scrollLeft;
    }

    function canAnimate() {
      return runningRef.current && visible && !document.hidden && !keyboardFocus && !pointer && cycle > 0;
    }

    function tick(time: number) {
      frame = null;
      if (!canAnimate()) return;
      writePosition(advanceShowcase(position, previousTime === null ? 0 : time - previousTime, cycle));
      previousTime = time;
      frame = requestAnimationFrame(tick);
    }

    function refresh() {
      if (canAnimate()) {
        if (frame === null) {
          position = rail!.scrollLeft;
          previousTime = null;
          frame = requestAnimationFrame(tick);
        }
      } else {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        previousTime = null;
      }
    }

    function measure() {
      const before = rail!.querySelector<HTMLElement>('[data-showcase-copy="0"]');
      const original = rail!.querySelector<HTMLElement>('[data-showcase-copy="1"]');
      if (!before || !original) return;
      const fraction = cycle > 0 ? (loopOffset(rail!.scrollLeft, cycle) - cycle) / cycle : 0;
      cycle = original.offsetLeft - before.offsetLeft;
      writePosition(cycle * (1 + fraction));
      refresh();
    }

    function onScroll() {
      if (Math.abs(rail!.scrollLeft - lastWritten) < 0.5) return;
      // Preserve browser focus scrolling inside the one accessible copy.
      writePosition(keyboardFocus ? rail!.scrollLeft : loopOffset(rail!.scrollLeft, cycle));
    }

    function onPointerDown(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: rail!.scrollLeft, intent: "pending" };
      keyboardFocus = false;
      suppressClick = false;
      // Do not focus a moving button or begin native text/image dragging on a mouse press.
      if (event.pointerType === "mouse") event.preventDefault();
      refresh();
    }

    function onPointerMove(event: PointerEvent) {
      if (!pointer || pointer.id !== event.pointerId) return;
      const x = event.clientX - pointer.x;
      const y = event.clientY - pointer.y;
      if (pointer.intent === "pending") {
        pointer.intent = dragIntent(x, y);
        if (pointer.intent === "horizontal") {
          suppressClick = true;
          rail!.setPointerCapture(event.pointerId);
          rail!.setAttribute("data-dragging", "");
        }
      }
      if (pointer.intent !== "horizontal") return;
      if (event.cancelable) event.preventDefault();
      writePosition(loopOffset(pointer.offset - x, cycle));
    }

    function onPointerEnd(event: PointerEvent) {
      // Touch starts with implicit capture on the preview button. Its bubbling loss
      // during transfer to the rail is not the end of the gesture.
      if (event.type === "lostpointercapture" && event.target !== rail) return;
      if (!pointer || pointer.id !== event.pointerId) return;
      pointer = null;
      rail!.removeAttribute("data-dragging");
      if (rail!.hasPointerCapture(event.pointerId)) rail!.releasePointerCapture(event.pointerId);
      refresh();
    }

    function onPointerLeave(event: PointerEvent) {
      if (pointer?.intent === "pending" && event.pointerType === "mouse") onPointerEnd(event);
    }

    function onClick(event: MouseEvent) {
      if (!suppressClick || event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    }

    function onFocus(event: FocusEvent) {
      keyboardFocus = event.target instanceof HTMLElement && event.target.matches(":focus-visible");
      refresh();
    }

    function onBlur(event: FocusEvent) {
      if (event.relatedTarget instanceof Node && rail!.contains(event.relatedTarget)) return;
      keyboardFocus = false;
      refresh();
    }

    function onKeyDown() { keyboardFocus = true; refresh(); }
    function preventNativeDrag(event: DragEvent) { event.preventDefault(); }
    function onWindowBlur() {
      const id = pointer?.id;
      pointer = null;
      rail!.removeAttribute("data-dragging");
      if (id !== undefined && rail!.hasPointerCapture(id)) rail!.releasePointerCapture(id);
      refresh();
    }

    rail.setAttribute("data-looping", "");
    refreshRef.current = refresh;
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(rail);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); });
    intersection.observe(rail);
    rail.addEventListener("scroll", onScroll, { passive: true });
    rail.addEventListener("pointerdown", onPointerDown);
    rail.addEventListener("pointermove", onPointerMove, { passive: false });
    rail.addEventListener("pointerleave", onPointerLeave);
    rail.addEventListener("lostpointercapture", onPointerEnd);
    rail.addEventListener("click", onClick, true);
    rail.addEventListener("focusin", onFocus);
    rail.addEventListener("focusout", onBlur);
    rail.addEventListener("keydown", onKeyDown);
    rail.addEventListener("dragstart", preventNativeDrag);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      refreshRef.current = null;
      resize.disconnect();
      intersection.disconnect();
      rail.removeAttribute("data-looping");
      rail.removeAttribute("data-dragging");
      rail.removeEventListener("scroll", onScroll);
      rail.removeEventListener("pointerdown", onPointerDown);
      rail.removeEventListener("pointermove", onPointerMove);
      rail.removeEventListener("pointerleave", onPointerLeave);
      rail.removeEventListener("lostpointercapture", onPointerEnd);
      rail.removeEventListener("click", onClick, true);
      rail.removeEventListener("focusin", onFocus);
      rail.removeEventListener("focusout", onBlur);
      rail.removeEventListener("keydown", onKeyDown);
      rail.removeEventListener("dragstart", preventNativeDrag);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [count]);

  return railRef;
}
