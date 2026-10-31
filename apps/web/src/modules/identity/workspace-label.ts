import type { Copy } from "@/content/copy";
import { APP_COPY as PORTUGUESE_APP_COPY } from "@/content/pt-BR";
import type { WorkspaceKind } from "./permissions";

/** Personal workspaces always show the UI term (UX-003), never the stored name. */
export function workspaceLabel(workspace: { kind: WorkspaceKind; name: string }, APP_COPY: Copy["APP_COPY"] = PORTUGUESE_APP_COPY): string {
  return workspace.kind === "personal" ? APP_COPY.workspace.personalLabel : workspace.name;
}
