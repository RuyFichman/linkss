"use client";

import { useEffect, useRef } from "react";
import { AUTH_COPY } from "@/content/pt-BR";
import { CAPTCHA_SCRIPT_URL, captchaSiteKey } from "../captcha";

interface Turnstile {
  render(container: HTMLElement, options: { sitekey: string; language: string; size: string }): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

function turnstile(): Turnstile | undefined {
  return (window as unknown as { turnstile?: Turnstile }).turnstile;
}

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (turnstile()) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CAPTCHA_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("captcha script"));
    };
    document.head.append(script);
  });
  return loading;
}

/**
 * The Turnstile widget (ADR 0018). It adds a hidden `cf-turnstile-response` field to the form it
 * sits in; the Server Action forwards that token to Supabase Auth. A token works once, so the
 * widget starts again whenever `resetSignal` changes (pass the form state: a new one arrives after
 * every submission). Renders nothing when the environment has no site key.
 */
export function CaptchaField({ resetSignal }: { resetSignal: unknown }) {
  const siteKey = captchaSiteKey(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadScript().then(() => {
      const api = turnstile();
      if (cancelled || !api || !containerRef.current || widgetRef.current) return;
      widgetRef.current = api.render(containerRef.current, { sitekey: siteKey, language: "pt-BR", size: "flexible" });
    }).catch(() => {
      // Blocked or offline: the form still submits and the server answers with the captcha message.
    });
    return () => {
      cancelled = true;
      if (widgetRef.current) turnstile()?.remove(widgetRef.current);
      widgetRef.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (widgetRef.current) turnstile()?.reset(widgetRef.current);
  }, [resetSignal]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="min-h-[65px]" role="group" aria-label={AUTH_COPY.captcha.label} />;
}
