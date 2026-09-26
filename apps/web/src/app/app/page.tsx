import { redirect } from "next/navigation";
import { resolveAccount } from "@/modules/identity/session";
import { getProfileRepository } from "@/modules/profiles/server";

export const dynamic = "force-dynamic";

/** Entry point: first-time people go to onboarding; everyone else to their personal workspace. */
export default async function AppHomePage() {
  const account = await resolveAccount();
  if (account.status === "anonymous") redirect("/entrar?next=/app");
  if (account.status !== "ready") return null; // the layout renders the retry state

  const repository = await getProfileRepository();
  const isFirstVisit = account.workspaces.length === 1 && (await repository.countLive(account.personal.workspaceId)) === 0;
  redirect(isFirstVisit ? "/app/comecar" : `/app/w/${account.personal.workspaceId}`);
}
