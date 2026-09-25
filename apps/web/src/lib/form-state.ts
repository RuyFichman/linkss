/** Shape returned by Server Actions used with React's useActionState. */
export interface FormState<Field extends string = string> {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<Field, string>>;
  /** Non-secret values echoed back so the form keeps what the person typed. */
  values?: Partial<Record<Field, string>>;
  /** Machine-readable hint for the UI (e.g. "email-not-confirmed"); never shown directly. */
  code?: string;
}

export const IDLE_FORM_STATE: FormState = { status: "idle" };
