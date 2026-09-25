"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PageDocument } from "@/modules/editor/model";
import { seedState } from "./seeds";
import type { DebugFlags, ProtoState, PrototypeEventName, ReportLink, Scenario } from "./types";

const STORAGE_KEY = "lnk-proto:v1";

interface ProtoContextValue {
  state: ProtoState;
  chooseScenario: (scenario: Scenario) => void;
  reset: () => void;
  record: (name: PrototypeEventName, detail?: string) => void;
  setDebug: (patch: Partial<DebugFlags>) => void;
  setUser: (user: { name: string; email: string }) => void;
  updateProfile: (document: PageDocument) => void;
  addProfile: (document: PageDocument) => void;
  archiveProfile: (profileId: string) => void;
  addReport: (report: ReportLink) => void;
  revokeReport: (token: string) => void;
}

const ProtoContext = createContext<ProtoContextValue | null>(null);
const noopSubscribe = () => () => undefined;

function readInitialState(): ProtoState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProtoState;
      if (parsed.version === 1 && Array.isArray(parsed.profiles) && Array.isArray(parsed.events)) return parsed;
    }
  } catch { /* Corrupted local data falls back to a safe seed. */ }
  return seedState("new-user");
}

function ProtoProviderInner({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProtoState>(readInitialState);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state]);

  const record = useCallback((name: PrototypeEventName, detail?: string) => setState((current) => ({ ...current, events: [...current.events, { name, at: new Date().toISOString(), detail }] })), []);
  const chooseScenario = useCallback((scenario: Scenario) => setState(seedState(scenario)), []);
  const reset = useCallback(() => setState(seedState("new-user")), []);
  const setDebug = useCallback((patch: Partial<DebugFlags>) => setState((current) => ({ ...current, debug: { ...current.debug, ...patch } })), []);
  const setUser = useCallback((user: { name: string; email: string }) => setState((current) => ({ ...current, user })), []);
  const updateProfile = useCallback((document: PageDocument) => setState((current) => ({ ...current, profiles: current.profiles.map((profile) => profile.id === document.id ? structuredClone(document) : profile) })), []);
  const addProfile = useCallback((document: PageDocument) => setState((current) => ({ ...current, profiles: [...current.profiles.filter((profile) => profile.id !== document.id), structuredClone(document)] })), []);
  const archiveProfile = useCallback((profileId: string) => setState((current) => ({ ...current, profiles: current.profiles.map((profile) => profile.id === profileId ? { ...profile, status: "archived" } : profile) })), []);
  const addReport = useCallback((report: ReportLink) => setState((current) => ({ ...current, reports: [report, ...current.reports] })), []);
  const revokeReport = useCallback((token: string) => setState((current) => ({ ...current, reports: current.reports.map((report) => report.token === token ? { ...report, status: "revoked" } : report) })), []);

  const value = useMemo(() => ({ state, chooseScenario, reset, record, setDebug, setUser, updateProfile, addProfile, archiveProfile, addReport, revokeReport }), [state, chooseScenario, reset, record, setDebug, setUser, updateProfile, addProfile, archiveProfile, addReport, revokeReport]);
  return <ProtoContext.Provider value={value}>{children}</ProtoContext.Provider>;
}

export function ProtoProvider({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!mounted) return <div className="app-shell grid min-h-screen place-items-center" role="status">Carregando protótipo…</div>;
  return <ProtoProviderInner>{children}</ProtoProviderInner>;
}

export function usePrototype(): ProtoContextValue {
  const context = useContext(ProtoContext);
  if (!context) throw new Error("usePrototype must be used inside ProtoProvider");
  return context;
}
