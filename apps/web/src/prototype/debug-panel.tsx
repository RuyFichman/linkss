"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { timeToFirstPublish } from "./metrics";
import { usePrototype } from "./store";
import { Button, SelectField, Switch } from "@/ui";

const noopSubscribe = () => () => undefined;

export function DebugPanel() {
  const { state, setDebug } = usePrototype();
  const queryOpen = useSyncExternalStore(noopSubscribe, () => new URLSearchParams(window.location.search).get("debug") === "1", () => false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.altKey && event.shiftKey && event.key.toLowerCase() === "d") setShortcutOpen((value) => !value); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const open = queryOpen || shortcutOpen;
  if (!open) return null;
  const elapsed = timeToFirstPublish(state.events);
  const copyJson = async () => { await navigator.clipboard.writeText(JSON.stringify({ scenario: state.scenario, sessionStartedAt: state.sessionStartedAt, timeToFirstPublishMs: elapsed, events: state.events }, null, 2)); };
  return <aside className="fixed bottom-3 left-3 z-[80] max-h-[80vh] w-[min(390px,calc(100%-1.5rem))] overflow-auto rounded-2xl border border-app-border bg-app-surface p-4 shadow-raised" aria-label="Painel de depuração"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Depuração do protótipo</h2><button type="button" className="font-bold text-app-accent" onClick={() => setShortcutOpen(false)} disabled={queryOpen}>Fechar</button></div><p className="mt-1 text-xs text-app-muted">Somente dados deste navegador. Alt+Shift+D alterna o painel.</p><div className="mt-4 grid gap-2"><Switch checked={state.debug.forceSaveError} label="Forçar erro ao salvar" onChange={(value) => setDebug({ forceSaveError: value })} /><Switch checked={state.debug.slowSave} label="Salvar lentamente" onChange={(value) => setDebug({ slowSave: value })} /><Switch checked={state.debug.forcePublishError} label="Forçar erro ao publicar" onChange={(value) => setDebug({ forcePublishError: value })} /><SelectField id="debug-analytics" label="Estado de resultados" value={state.debug.analyticsMode} onChange={(event) => setDebug({ analyticsMode: event.target.value as typeof state.debug.analyticsMode })}><option value="data">Com dados</option><option value="no-data">Sem dados ainda</option><option value="zero">Zero no período</option><option value="loading">Carregando</option><option value="error">Erro</option></SelectField></div><div className="mt-4 rounded-xl bg-app-surface-soft p-3"><b>Tempo até publicar:</b> {elapsed === null ? "ainda não publicado" : `${Math.round(elapsed / 1000)} s`}<ol className="mt-3 max-h-40 overflow-auto text-xs">{state.events.map((event, index) => <li key={`${event.at}-${index}`}>{new Date(event.at).toLocaleTimeString("pt-BR")} — {event.name}{event.detail ? ` (${event.detail})` : ""}</li>)}</ol></div><Button className="mt-3 w-full" variant="secondary" onClick={copyJson}>Copiar timeline em JSON</Button></aside>;
}
