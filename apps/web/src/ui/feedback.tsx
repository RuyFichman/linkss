import type { CSSProperties, ReactNode } from "react";
import { Button } from "./button";

type Tone = "neutral" | "success" | "warning" | "danger" | "accent";
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) { return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>; }
export const StatusChip = Badge;
export type SaveState = "idle" | "saving" | "saved" | "error";
const SAVE_LABELS: Record<SaveState, string> = { idle: "Alterações não publicadas", saving: "Salvando…", saved: "Salvo", error: "Não foi possível salvar — tentar novamente" };
export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  const tone: Tone = state === "error" ? "danger" : state === "saved" ? "success" : state === "idle" ? "warning" : "neutral";
  return <span role="status" aria-live="polite" className="inline-flex min-h-11 items-center gap-2"><Badge tone={tone}>{SAVE_LABELS[state]}</Badge>{state === "error" && onRetry ? <button type="button" className="font-bold text-app-accent underline" onClick={onRetry}>Tentar novamente</button> : null}</span>;
}
export function Toast({ actionLabel, children, onAction }: { actionLabel?: string; children: ReactNode; onAction?: () => void }) { return <div className="ui-toast" role="status" aria-live="polite"><span>{children}</span>{actionLabel && onAction ? <Button type="button" variant="ghost" onClick={onAction}>{actionLabel}</Button> : null}</div>; }
export function EmptyState({ action, description, title }: { action?: ReactNode; description: string; title: string }) { return <div className="ui-empty"><strong className="text-lg text-app-text">{title}</strong><p className="m-0 max-w-md">{description}</p>{action}</div>; }
export function Skeleton({ height = 20, width = "100%" }: { height?: number; width?: CSSProperties["width"] }) { return <span className="ui-skeleton block" style={{ height, width }} aria-hidden="true" />; }
