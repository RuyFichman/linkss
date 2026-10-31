"use client";

import { useActionState } from "react";
import { APP_COPY as APP_COPY_BY_LOCALE } from "@/content/localized";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { LOCALES, type Locale } from "@/lib/locale";
import { Button, SelectField } from "@/ui";
import { FormStatus } from "@/ui/form-status";
import { useCopy } from "@/ui/locale-context";

type PageLocaleAction = (previous: FormState, formData: FormData) => Promise<FormState>;

/**
 * The language of the words the product puts on the published page (ADR 0022). A plain select and
 * a button: works without JavaScript. Each option names its language in that language.
 */
export function PageLocaleForm({ action, current }: { action: PageLocaleAction; current: Locale }) {
  const APP_COPY = useCopy(APP_COPY_BY_LOCALE);
  const copy = APP_COPY.pageLocale;
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="grid gap-3">
      <SelectField id="page-locale" name="locale" label={copy.label} defaultValue={current}>
        {LOCALES.map((locale) => <option key={locale} value={locale}>{copy.options[locale]}</option>)}
      </SelectField>
      <div><Button type="submit" variant="secondary" loading={pending}>{copy.submit}</Button></div>
      <FormStatus state={state} />
    </form>
  );
}
