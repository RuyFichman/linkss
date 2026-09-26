import type { SocialNetwork } from "../social";

/**
 * Simplified monochrome glyphs (not official logos) so the renderer ships no icon library or
 * external request. Always decorative: the link carries the accessible name.
 */
export function SocialIcon({ network }: { network: SocialNetwork }) {
  const common = { width: 24, height: 24, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (network) {
    case "instagram":
      return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>;
    case "tiktok":
      return <svg {...common}><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" /><path d="M14 3c.5 2.8 2.4 4.6 5 5" /></svg>;
    case "youtube":
      return <svg {...common}><rect x="2.5" y="5.5" width="19" height="13" rx="4" /><path d="M10.5 9.5v5l4.5-2.5z" fill="currentColor" /></svg>;
    case "facebook":
      return <svg {...common}><path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V21" /><path d="M6 11h8" /></svg>;
    case "linkedin":
      return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 11v6M8 7.5v.01M12 17v-6M12 13.5a2.5 2.5 0 0 1 5 0V17" /></svg>;
    case "x":
      return <svg {...common}><path d="M4 4l16 16M20 4L4 20" /></svg>;
    case "threads":
      return <svg {...common}><path d="M16.5 11.5c0-3-1.8-4.5-4.4-4.5-2.2 0-3.6 1.1-4.1 2.7" /><path d="M16.5 11.5c0 5-2.3 8.5-5 8.5-4 0-6.5-3-6.5-8s2.5-8 7-8c3.5 0 5.8 1.7 6.7 4.5" /><path d="M16.5 11.5c-3.5-.8-6.5 0-6.5 2.3 0 2.5 4 2.6 5 .2" /></svg>;
    case "pinterest":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M11 21l2-9M10 11.5a3 3 0 1 1 3.5 3c-1 .1-2-.3-2.3-1" /></svg>;
  }
}
