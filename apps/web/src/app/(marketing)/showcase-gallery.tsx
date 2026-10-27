"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Dialog } from "@/ui/dialog";

export interface ShowcaseEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  page: ReactNode;
}

/** The pages are server-rendered slots; only opening the larger preview needs client code. */
export function ShowcaseGallery({ entries }: { entries: ShowcaseEntry[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const active = entries.find((entry) => entry.id === selected);
  return <>
    <ul className="showcase-rail" aria-labelledby="modelos-titulo" tabIndex={0}>
      {entries.map((entry) => <li key={entry.id} className="showcase-item">
        <div className="showcase-frame">
          <div className="showcase-miniature" aria-hidden="true">{entry.page}</div>
          <button type="button" className="showcase-open" onClick={() => setSelected(entry.id)} aria-haspopup="dialog" aria-label={`Explorar página de ${entry.name} — ${entry.category}`}>
            <span className="showcase-open-label">Explorar página</span>
          </button>
        </div>
        <div className="showcase-caption"><h3>{entry.name}</h3><p>{entry.category}</p></div>
      </li>)}
    </ul>
    <Dialog open={Boolean(active)} onClose={() => setSelected(null)} title={active ? `Página de ${active.name}` : "Visualização da página"}>
      {active ? <div className="showcase-detail">
        <p className="showcase-description">{active.description}</p>
        <div className="showcase-full">{active.page}</div>
        <div className="showcase-detail-cta"><Link href="/cadastro" className="home-cta">Criar minha página</Link></div>
      </div> : null}
    </Dialog>
  </>;
}
