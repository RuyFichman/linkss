"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_COPY } from "@/content/pt-BR";

/** Sections of one workspace. Navigation only: every page re-checks membership on the server. */
export function WorkspaceNav({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const base = `/app/w/${workspaceId}`;
  const items = [
    { href: base, label: APP_COPY.nav.pages, current: pathname === base || pathname.startsWith(`${base}/paginas`) },
    { href: `${base}/resultados`, label: APP_COPY.nav.results, current: pathname.startsWith(`${base}/resultados`) },
    { href: `${base}/membros`, label: APP_COPY.nav.members, current: pathname.startsWith(`${base}/membros`) },
  ];
  return (
    <nav data-app-chrome="" aria-label={APP_COPY.nav.workspace} className="app-tabs mb-6">
      {items.map((item) => <Link key={item.href} className="app-tab" href={item.href} aria-current={item.current ? "page" : undefined}>{item.label}</Link>)}
    </nav>
  );
}
