"use client";
import { useEffect, type RefObject } from "react";

/** After a failed submit, moves focus to the first invalid field so keyboard users land on it. */
export function useFocusFirstError(formRef: RefObject<HTMLFormElement | null>, state: { status: string; fieldErrors?: object }) {
  useEffect(() => {
    if (state.status !== "error" || !state.fieldErrors || Object.keys(state.fieldErrors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [formRef, state]);
}
