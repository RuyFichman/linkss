"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { Dialog } from "@/ui/dialog";
import { useShowcaseMotion } from "./use-showcase-motion";

export interface ShowcaseEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  page: ReactNode;
  openLabel: string;
  dialogTitle: string;
}

/** The gallery's own words, already in the home's language (ADR 0022). */
export interface ShowcaseWords {
  dragHint: string;
  pause: string;
  resume: string;
  explore: string;
  dialogFallback: string;
  close: string;
  create: string;
}

/** Page compositions remain server-rendered slots, including the visual copies at the loop seams. */
export function ShowcaseGallery({ entries, signUpHref, words }: { entries: ShowcaseEntry[]; signUpHref: string; words: ShowcaseWords }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const instructionId = useId();
  const railId = useId();
  const railRef = useShowcaseMotion(entries.length, !paused && !selected);
  const active = entries.find((entry) => entry.id === selected);
  return <>
    <div className="showcase-controls home-shell">
      <p id={instructionId}>{words.dragHint}</p>
      <button type="button" className="showcase-motion-toggle" aria-controls={railId} onClick={() => setPaused(!paused)}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="currentColor">{paused ? <path d="M6 3l11 7-11 7z" /> : <path d="M5 3h3v14H5zm7 0h3v14h-3z" />}</svg>
        {paused ? words.resume : words.pause}
      </button>
    </div>
    <ul ref={railRef} id={railId} className="showcase-rail" aria-labelledby="modelos-titulo" aria-describedby={instructionId} aria-live="off" tabIndex={0}>
      {(entries.length > 1 ? [0, 1, 2] : [1]).flatMap((copy) => entries.map((entry) => <li key={`${copy}-${entry.id}`} className="showcase-item" data-showcase-copy={copy} aria-hidden={copy !== 1 ? true : undefined}>
        <div className="showcase-frame">
          <div className="showcase-miniature" aria-hidden="true">{entry.page}</div>
          <button type="button" className="showcase-open" data-showcase-original={copy === 1 ? entry.id : undefined} tabIndex={copy === 1 ? 0 : -1} onClick={() => {
            // Return modal focus to the accessible copy even when a visual seam copy was clicked.
            railRef.current?.querySelector<HTMLButtonElement>(`[data-showcase-original="${entry.id}"]`)?.focus({ preventScroll: true });
            setSelected(entry.id);
          }} aria-haspopup="dialog" aria-label={entry.openLabel}>
            <span className="showcase-open-label">{words.explore}</span>
          </button>
        </div>
        <div className="showcase-caption"><h3>{entry.name}</h3><p>{entry.category}</p></div>
      </li>))}
    </ul>
    <Dialog open={Boolean(active)} onClose={() => setSelected(null)} title={active ? active.dialogTitle : words.dialogFallback} closeLabel={words.close}>
      {active ? <div className="showcase-detail">
        <p className="showcase-description">{active.description}</p>
        <div className="showcase-full">{active.page}</div>
        <div className="showcase-detail-cta"><Link href={signUpHref} className="home-cta">{words.create}</Link></div>
      </div> : null}
    </Dialog>
  </>;
}
