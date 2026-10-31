"use client";

import { useActionState } from "react";
import { APP_COPY as APP_COPY_BY_LOCALE, MY_DATA_COPY as MY_DATA_COPY_BY_LOCALE } from "@/content/localized";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import { LOCALES } from "@/lib/locale";
import { Button, SelectField } from "@/ui";
import { FormStatus } from "@/ui/form-status";
import { useCopy, useLocale } from "@/ui/locale-context";
import { setAccountLocaleAction } from "../account-locale";

/** The account language on "Meus dados" (ADR 0022). A select and a button: works without JavaScript. */
export function AccountLocaleForm() {
  const copy = useCopy(MY_DATA_COPY_BY_LOCALE).locale;
  // Each language is named in itself, the same list as the page language.
  const names = useCopy(APP_COPY_BY_LOCALE).pageLocale.options;
  const current = useLocale();
  const [state, formAction, pending] = useActionState(setAccountLocaleAction, IDLE_FORM_STATE);
  return (
    <form action={formAction} className="mt-4 grid gap-3">
      <SelectField id="account-locale" name="locale" label={copy.label} defaultValue={current}>
        {LOCALES.map((locale) => <option key={locale} value={locale}>{names[locale]}</option>)}
      </SelectField>
      <div><Button type="submit" variant="secondary" loading={pending}>{copy.submit}</Button></div>
      <FormStatus state={state} />
    </form>
  );
}
