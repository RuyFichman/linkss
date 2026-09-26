"use client";

import { useEffect, useState } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { checkSlugAction } from "../actions";
import { normalizeSlug, validateSlug, type SlugValidation } from "../slug";

const DEBOUNCE_MS = 400;

interface SlugFieldProps {
  id: string;
  workspaceId: string;
  /** Existing address (settings) — shown as current instead of "taken". */
  currentSlug?: string;
  /** While the person has not typed an address, suggest one from this text (e.g. the title). */
  suggestFrom?: string;
  defaultValue?: string;
  error?: string;
}

/**
 * Address input with live normalization and a debounced server availability check. The server
 * re-validates on submit; this only gives early, accessible feedback (polite live region).
 */
export function SlugField({ id, workspaceId, currentSlug, suggestFrom, defaultValue, error }: SlugFieldProps) {
  const [typed, setTyped] = useState<string | null>(defaultValue ?? null);
  const value = typed ?? normalizeSlug(suggestFrom ?? "");
  const local = validateSlug(value);
  const isCurrent = Boolean(currentSlug) && local.normalized === currentSlug;
  const [remote, setRemote] = useState<{ slug: string; result: SlugValidation } | null>(null);

  const { valid: localValid, normalized } = local;
  useEffect(() => {
    if (!localValid || isCurrent) return;
    const timer = setTimeout(() => {
      checkSlugAction(normalized, workspaceId)
        .then((result) => setRemote({ slug: normalized, result }))
        .catch(() => setRemote({ slug: normalized, result: { normalized, status: "invalid", valid: false, message: APP_COPY.errors.unavailable } }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [localValid, normalized, isCurrent, workspaceId]);

  const status: { tone: "muted" | "success" | "danger"; text: string } = !value
    ? { tone: "muted", text: "" }
    : !local.valid ? { tone: "danger", text: local.message }
    : isCurrent ? { tone: "muted", text: "Este é o endereço atual." }
    : remote?.slug === local.normalized ? { tone: remote.result.valid ? "success" : "danger", text: remote.result.message }
    : { tone: "muted", text: APP_COPY.profileForm.checking };

  const describedBy = [`${id}-hint`, `${id}-status`, error ? `${id}-error` : ""].filter(Boolean).join(" ");
  const toneClass = status.tone === "success" ? "font-bold text-app-success" : status.tone === "danger" ? "font-bold text-app-danger" : "text-app-muted";

  return (
    <div className="ui-field">
      <label htmlFor={id}>{APP_COPY.profileForm.slug}</label>
      <div className="ui-input-group">
        <span className="shrink-0 pl-3 text-sm text-app-muted" aria-hidden="true">{APP_COPY.pages.publicAddressPrefix}</span>
        <input
          id={id}
          name="slug"
          className="ui-input ui-input-bare min-w-0 pl-1"
          value={value}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={60}
          required
          aria-invalid={Boolean(error) || (Boolean(value) && !local.valid)}
          aria-describedby={describedBy}
        />
      </div>
      <p className="ui-hint" id={`${id}-hint`}>
        {local.normalized && local.normalized !== value ? <>Seu endereço será <b>{local.normalized}</b>. </> : null}
        {APP_COPY.profileForm.slugHint}
      </p>
      <p id={`${id}-status`} role="status" aria-live="polite" className={`m-0 text-sm ${toneClass}`}>{status.text}</p>
      {error ? <p className="ui-error" id={`${id}-error`} role="alert">{error}</p> : null}
    </div>
  );
}
