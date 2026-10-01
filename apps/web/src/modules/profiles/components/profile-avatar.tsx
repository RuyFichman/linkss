import { avatarSources } from "@/modules/media/url";
import { initialsFor } from "../content";

/**
 * Page avatar in the app: the uploaded image when there is one, initials otherwise. Decorative in
 * both cases: the page title is always visible next to it.
 */
export function ProfileAvatar({ title, avatarPath = null, size = "md" }: { title: string; avatarPath?: string | null; size?: "md" | "lg" }) {
  const pixels = size === "lg" ? 80 : 48;
  const dimension = size === "lg" ? "h-20 w-20 text-2xl" : "h-12 w-12 text-base";
  if (avatarPath) {
    return (
      <picture className={`inline-block shrink-0 ${size === "lg" ? "h-20 w-20" : "h-12 w-12"}`}>
        <img {...avatarSources(avatarPath)} className={`rounded-full border border-app-border object-cover ${size === "lg" ? "h-20 w-20" : "h-12 w-12"}`} width={pixels} height={pixels} alt="" />
      </picture>
    );
  }
  return <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center rounded-full bg-app-accent font-bold text-white ${dimension}`}>{initialsFor(title)}</span>;
}
