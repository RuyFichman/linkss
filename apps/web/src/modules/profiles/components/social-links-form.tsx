"use client";

import { useActionState, useRef } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { SOCIAL_NETWORK_IDS, SOCIAL_NETWORKS, type SocialLink } from "@/modules/publishing/social";
import { Button, FormStatus, TextField } from "@/ui";
import { useFocusFirstError } from "@/ui/use-focus-first-error";
import type { ProfileField } from "../service";

type SocialAction = (previous: FormState, formData: FormData) => Promise<FormState<ProfileField>>;

export function SocialLinksForm({ action, links }: { action: SocialAction; links: SocialLink[] }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const current = new Map(links.map((link) => [link.network, link.url]));

  return (
    <form ref={formRef} action={formAction} className="grid gap-4" noValidate aria-describedby="social-status">
      <div className="grid gap-4 sm:grid-cols-2">
        {SOCIAL_NETWORK_IDS.map((network) => (
          <TextField
            key={network}
            id={`social-${network}`}
            name={network}
            label={SOCIAL_NETWORKS[network].label}
            placeholder={APP_COPY.social.placeholder}
            defaultValue={state.values?.[network] ?? current.get(network) ?? ""}
            autoComplete="off"
            inputMode="url"
            maxLength={300}
            error={state.fieldErrors?.[network]}
          />
        ))}
      </div>
      <FormStatus id="social-status" state={state} />
      <Button type="submit" loading={pending} className="w-full sm:w-fit">{APP_COPY.social.save}</Button>
    </form>
  );
}
