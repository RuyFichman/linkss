"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { APP_COPY } from "@/content/pt-BR";
import { workspaceLabel } from "../workspace-label";
import type { WorkspaceKind, WorkspaceRole } from "../permissions";

export interface SwitcherWorkspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  role: WorkspaceRole;
}

/**
 * Context switch only: each link is a normal navigation and every page re-checks membership on the
 * server, so choosing a workspace never grants anything by itself.
 */
export function WorkspaceSwitcher({ workspaces }: { workspaces: SwitcherWorkspace[] }) {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const currentId = /^\/app\/w\/([^/]+)/.exec(pathname)?.[1];
  const current = workspaces.find((workspace) => workspace.id === currentId);
  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return (
    <details ref={detailsRef} className="relative">
      <summary className="ui-button ui-button-secondary max-w-[60vw] cursor-pointer list-none">
        <span className="sr-only">{APP_COPY.workspace.switcherLabel}: </span>
        <span className="truncate">{current ? workspaceLabel(current) : APP_COPY.workspace.switcherLabel}</span>
        <span aria-hidden="true">▾</span>
      </summary>
      <div className="absolute left-0 z-40 mt-2 grid w-72 max-w-[calc(100vw-2rem)] gap-1 rounded-2xl border border-app-border bg-app-surface p-2 shadow-raised">
        <ul className="m-0 grid list-none gap-1 p-0" aria-label={APP_COPY.workspace.switcherLabel}>
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link href={`/app/w/${workspace.id}`} onClick={close} aria-current={workspace.id === currentId ? "page" : undefined} className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-app-surface-soft aria-[current=page]:bg-app-accent/10 aria-[current=page]:font-bold">
                <span className="truncate">{workspaceLabel(workspace)}</span>
                {workspace.kind === "agency" ? <span className="text-xs text-app-muted">{APP_COPY.roles[workspace.role]}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/app/contas/nova" onClick={close} className="flex min-h-11 items-center rounded-xl border-t border-app-border px-3 py-2 font-bold text-app-accent">+ {APP_COPY.workspace.createAgency}</Link>
      </div>
    </details>
  );
}
