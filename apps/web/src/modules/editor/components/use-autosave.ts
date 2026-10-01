"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { saveDraftAction } from "@/modules/profiles/actions";
import type { DraftContent } from "@/modules/profiles/service";
import { createAutosave, type Autosave } from "../draft/autosave";

/**
 * Binds the framework-free autosave controller to the page's Server Action. One controller per
 * mounted editor; it survives re-renders and server refreshes of the page.
 */
export function useAutosave(profileId: string, initialRevision: number): { autosave: Autosave<DraftContent>; snapshot: ReturnType<Autosave<DraftContent>["getSnapshot"]> } {
  const [autosave] = useState(() => createAutosave<DraftContent>({
    revision: initialRevision,
    save: async (draft, expectedRevision) => {
      const result = await saveDraftAction(profileId, { expectedRevision, title: draft.title, bio: draft.bio, avatarPath: draft.avatarPath, theme: draft.theme, blocks: draft.blocks });
      return result.ok ? { ok: true, revision: result.revision } : { ok: false, error: result.error };
    },
  }));
  useEffect(() => () => autosave.dispose(), [autosave]);
  const snapshot = useSyncExternalStore(autosave.subscribe, autosave.getSnapshot, autosave.getSnapshot);
  return { autosave, snapshot };
}
