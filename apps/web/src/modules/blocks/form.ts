/**
 * Form block definition (ADR 0010): a fixed catalog of four field types, not a form builder.
 * Mirror of private.is_valid_form_fields(); submission rules live in modules/leads/submission.ts.
 */
export const FORM_FIELDS = ["name", "email", "phone", "message"] as const;
export type FormField = (typeof FORM_FIELDS)[number];

/** `message` is the only optional field; the others are required when the form has them. */
export const FORM_FIELD_RULES: Record<FormField, { required: boolean; maxLength: number }> = {
  name: { required: true, maxLength: 100 },
  email: { required: true, maxLength: 254 },
  phone: { required: true, maxLength: 20 },
  message: { required: false, maxLength: 1000 },
};

export function isFormField(value: unknown): value is FormField {
  return typeof value === "string" && (FORM_FIELDS as readonly string[]).includes(value);
}

/** Catalog order, no repeats. */
export function orderFormFields(fields: Iterable<FormField>): FormField[] {
  const chosen = new Set(fields);
  return FORM_FIELDS.filter((field) => chosen.has(field));
}

/**
 * 1–4 distinct fields in catalog order, with at least one way to answer the person (e-mail or
 * phone). A form that only asks for a name would collect data nobody can act on.
 */
export function isValidFormFields(value: unknown): value is FormField[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > FORM_FIELDS.length) return false;
  if (!value.every(isFormField)) return false;
  const ordered = orderFormFields(value);
  if (ordered.length !== value.length || ordered.some((field, index) => field !== value[index])) return false;
  return ordered.includes("email") || ordered.includes("phone");
}
