import type { ReactNode } from "react";
import type { BlockType } from "@/modules/blocks";

export type StudioIconName =
  | "back" | "chevron" | "up" | "down" | "trash" | "plus" | "phone" | "desktop" | "pages" | "edit" | "results" | "contacts" | "preview" | "external"
  | "header" | "templates" | "colors" | "buttons" | "fonts" | BlockType;

const PATHS: Record<StudioIconName, ReactNode> = {
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></>,
  desktop: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  pages: <><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13 7l4 4" /></>,
  results: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  contacts: <><path d="M4 13l2-8h12l2 8v6H4v-6z" /><path d="M4 13h5l1 2h4l1-2h5" /></>,
  preview: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v6H4V6h6" /></>,
  header: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  templates: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>,
  colors: <path d="M12 3s7 7.5 7 12a7 7 0 01-14 0c0-4.5 7-12 7-12z" />,
  buttons: <><rect x="3" y="7" width="18" height="10" rx="5" /><path d="M9 12h6" /></>,
  fonts: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  link: <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>,
  text: <path d="M4 6h16M4 12h16M4 18h10" />,
  social: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 11l7.6-4M8.2 13l7.6 4" /></>,
  whatsapp: <path d="M4 20l1.3-4.2A8 8 0 1112 20a8 8 0 01-3.8-1L4 20z" />,
  divider: <path d="M4 12h16M9 7h6M9 17h6" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 9" /></>,
  embed: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3V9z" /></>,
  pix: <path d="M12 3l9 9-9 9-9-9 9-9zM8 12h8" />,
  form: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
};

/** Decorative line icon; the control that holds it carries the accessible name. */
export function StudioIcon({ name, size = 20 }: { name: StudioIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable={false} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
