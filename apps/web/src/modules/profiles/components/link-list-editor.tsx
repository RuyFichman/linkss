import { APP_COPY } from "@/content/pt-BR";
import { moveLinkAction, removeLinkAction, saveLinkAction } from "../actions";
import { MAX_BLOCKS, type DraftLinkBlock } from "../draft-content";
import { LinkForm } from "./link-form";
import { LinkListItem } from "./link-list-item";

/**
 * Minimal link editing for Sprint 3 so the public link block can be exercised end to end. The
 * Sprint 4 block editor (block types, duplicate, visibility, autosave, undo) replaces it.
 */
export function LinkListEditor({ profileId, links }: { profileId: string; links: DraftLinkBlock[] }) {
  return (
    <div className="grid gap-5">
      {links.length === 0 ? (
        <p className="m-0 text-app-muted">{APP_COPY.links.empty}</p>
      ) : (
        <ol className="m-0 grid list-none gap-3 p-0">
          {links.map((link, index) => (
            <LinkListItem
              key={link.id}
              link={link}
              isFirst={index === 0}
              isLast={index === links.length - 1}
              saveAction={saveLinkAction.bind(null, profileId, link.id)}
              removeAction={removeLinkAction.bind(null, profileId, link.id)}
              moveUpAction={moveLinkAction.bind(null, profileId, link.id, "up")}
              moveDownAction={moveLinkAction.bind(null, profileId, link.id, "down")}
            />
          ))}
        </ol>
      )}
      {links.length < MAX_BLOCKS ? (
        <div className="grid gap-3 border-t border-app-border pt-5">
          <h3 className="m-0 text-lg font-bold">{APP_COPY.links.addTitle}</h3>
          <LinkForm action={saveLinkAction.bind(null, profileId, null)} idPrefix="new-link" submitLabel={APP_COPY.links.add} />
        </div>
      ) : (
        <p className="m-0 text-app-muted">{APP_COPY.links.limit}</p>
      )}
    </div>
  );
}
