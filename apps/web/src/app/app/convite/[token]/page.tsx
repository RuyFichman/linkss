import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { APP_COPY, TEAM_COPY } from "@/content/pt-BR";
import { formatDateTime } from "@/lib/format-date";
import { AcceptInvitationForm } from "@/modules/identity/components/accept-invitation-form";
import { SignOutButton } from "@/modules/identity/components/sign-out-button";
import { invitationPath, isInvitationToken } from "@/modules/identity/invitations";
import { acceptInvitationAction } from "@/modules/identity/member-actions";
import { getMembersService } from "@/modules/identity/members-server";
import { EmptyState, Notice } from "@/ui";

// The token is in the path: never send this URL to another site as a referrer.
export const metadata: Metadata = { title: "Convite", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/**
 * Invitation acceptance (ADR 0012). The token only identifies the invitation; access is granted by
 * the explicit "Aceitar" action, to the signed-in account whose confirmed e-mail was invited. An
 * unknown, expired, revoked or used link shows one generic state.
 */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await (await getMembersService()).previewInvitation(token);
  if (!preview.ok) {
    // The proxy already sends signed-out visitors to sign-in with this path as `next`.
    if (preview.error === "unauthenticated") redirect(isInvitationToken(token) ? `/entrar?next=${encodeURIComponent(invitationPath(token))}` : "/entrar");
    return <div className="mx-auto max-w-xl"><Notice tone="danger">{TEAM_COPY.accept.unavailable}</Notice></div>;
  }

  const copy = TEAM_COPY.accept;
  const home = <Link className="ui-button ui-button-secondary" href="/app">{copy.home}</Link>;
  const invitation = preview.value;

  if (invitation.state === "valid" && invitation.workspaceName && invitation.role) {
    return (
      <div className="mx-auto max-w-xl">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-app-accent">{copy.pageTitle}</p>
        <h1 className="mt-2 text-3xl font-bold break-words">{copy.valid.title(invitation.workspaceName)}</h1>
        <section className="surface-card mt-6 grid gap-4 p-5 sm:p-8">
          <p className="m-0">{copy.valid.lead(invitation.inviterName, APP_COPY.roles[invitation.role])}</p>
          <p className="m-0 text-app-muted">{TEAM_COPY.roleHelp[invitation.role]}</p>
          {invitation.expiresAt ? <p className="m-0 text-sm text-app-muted">{copy.valid.expires(formatDateTime(invitation.expiresAt))}</p> : null}
          <AcceptInvitationForm action={acceptInvitationAction.bind(null, token)} />
        </section>
      </div>
    );
  }

  if (invitation.state === "wrong_account") {
    return <EmptyState title={copy.wrong_account.title} description={copy.wrong_account.description} action={<div className="flex flex-wrap justify-center gap-3"><SignOutButton label={copy.wrong_account.signOut} next={invitationPath(token)} />{home}</div>} />;
  }
  if (invitation.state === "already_member" && invitation.workspaceId) {
    return <EmptyState title={copy.already_member.title} description={copy.already_member.description} action={<Link className="ui-button ui-button-primary" href={`/app/w/${invitation.workspaceId}`}>{copy.already_member.open}</Link>} />;
  }
  if (invitation.state === "limit_reached") {
    return <EmptyState title={copy.limit_reached.title} description={copy.limit_reached.description} action={home} />;
  }
  return <EmptyState title={copy.invalid.title} description={copy.invalid.description} action={home} />;
}
