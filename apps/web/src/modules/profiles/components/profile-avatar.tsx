import { initialsFor } from "../content";

/** Initials placeholder until image upload ships (Sprint 5). Decorative: the title is always visible nearby. */
export function ProfileAvatar({ title, size = "md" }: { title: string; size?: "md" | "lg" }) {
  const dimension = size === "lg" ? "h-20 w-20 text-2xl" : "h-12 w-12 text-base";
  return <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center rounded-full bg-app-accent font-bold text-white ${dimension}`}>{initialsFor(title)}</span>;
}
