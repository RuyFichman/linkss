import type { Metadata } from "next";
import { APP_COPY, TEAM_COPY } from "@/content/pt-BR";
import { formatDateTime } from "@/lib/format-date";
import { limitUsage } from "@/modules/entitlements";
import { InviteMemberForm } from "@/modules/identity/components/invite-member-form";
import { MemberRoleForm } from "@/modules/identity/components/member-role-form";
import { invitationStatus, seatUsage } from "@/modules/identity/invitations";
import { changeMemberRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } from "@/modules/identity/member-actions";
import { fetchWorkspaceInvitations, fetchWorkspaceMembers } from "@/modules/identity/members-server";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { INVITABLE_ROLES, assignableRoles, can, canRemoveMember, WORKSPACE_ROLES } from "@/modules/identity/permissions";
import { resolveAccount } from "@/modules/identity/session";
import { getProfileRepository } from "@/modules/profiles/server";
import { Badge, Notice } from "@/ui";
import { ConfirmDialog } from "@/ui/confirm-dialog";

export const metadata: Metadata = { title: "Membros" };

/**
 * Who can reach the workspace: members with their roles, open invitations, and the commands the
 * viewer's role allows. Every command re-authorizes on the server and in the database; this page
 * only decides what to show. A fixed number of queries whatever the size of the team.
 */
export default async function MembersPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await authorizeWorkspacePage(workspaceId, "members.view");
  if (!access) return <Notice tone="warning">{APP_COPY.errors.forbidden}</Notice>;

  const canInvite = can(access.role, "members.invite");
  const [members, invitations, entitlements, account] = await Promise.all([
    fetchWorkspaceMembers(workspaceId),
    canInvite ? fetchWorkspaceInvitations(workspaceId) : Promise.resolve({ ok: true as const, value: [] }),
    (await getProfileRepository()).entitlements(workspaceId),
    resolveAccount(),
  ]);

  const heading = (
    <header>
      <h1 className="text-3xl font-bold">{TEAM_COPY.title}</h1>
      <p className="mt-2 text-app-muted">{TEAM_COPY.lead}</p>
    </header>
  );
  if (!members.ok || !invitations.ok) {
    const error = !members.ok ? members.error : !invitations.ok ? invitations.error : "unavailable";
    return <div className="grid gap-6">{heading}<Notice tone={error === "not_deployed" ? "neutral" : "danger"}>{error === "not_deployed" ? TEAM_COPY.unavailable : TEAM_COPY.errors.unavailable}</Notice></div>;
  }

  const now = new Date();
  const listed = invitations.value.map((invitation) => ({ ...invitation, status: invitationStatus(invitation, now) }));
  const pending = listed.filter((invitation) => invitation.status === "pending");
  const seats = seatUsage(members.value.length, pending.length, entitlements.limits.team_members);
  const memberUsage = limitUsage(entitlements, "team_members", members.value.length);
  const isPersonal = account.status === "ready" && account.workspaces.some((workspace) => workspace.workspaceId === workspaceId && workspace.kind === "personal");

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      {heading}

      <section className="surface-card grid gap-4 p-5 sm:p-8" aria-labelledby="members-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="members-title" className="text-xl font-bold">{TEAM_COPY.membersTitle}</h2>
          <Badge tone={(canInvite ? seats.reached : memberUsage.reached) ? "warning" : "accent"}>{TEAM_COPY.usage(canInvite ? seats.used : memberUsage.used, seats.limit)}</Badge>
        </div>
        {canInvite ? <p className="m-0 text-sm text-app-muted">{TEAM_COPY.usageDetail(seats.members, seats.pending)}</p> : null}
        <ul className="m-0 grid list-none gap-4 p-0">
          {members.value.map((member) => {
            const name = member.displayName ?? member.email ?? TEAM_COPY.noName;
            const roles = assignableRoles(access.role, member.role);
            const removable = canRemoveMember(access.role, member.role, member.isSelf) && !(member.isSelf && isPersonal);
            return (
              <li key={member.membershipId} className="grid gap-3 border-t border-app-border pt-4 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  <p className="m-0 flex flex-wrap items-center gap-2 font-bold">
                    <span className="break-words">{name}</span>
                    {member.isSelf ? <span className="font-normal text-app-muted">({TEAM_COPY.you})</span> : null}
                    <Badge tone={member.role === "owner" ? "accent" : "neutral"}>{APP_COPY.roles[member.role]}</Badge>
                  </p>
                  {member.email && member.displayName ? <p className="m-0 break-all text-sm text-app-muted">{member.email}</p> : null}
                  <p className="m-0 text-sm text-app-muted">{TEAM_COPY.joined(formatDateTime(member.joinedAt))}</p>
                </div>
                {roles.length > 0 || removable ? (
                  <div className="flex flex-wrap items-end gap-3">
                    {roles.length > 0 ? <MemberRoleForm action={changeMemberRoleAction.bind(null, workspaceId, member.membershipId)} membershipId={member.membershipId} name={name} current={member.role} options={roles} /> : null}
                    {removable ? (
                      member.isSelf ? (
                        <ConfirmDialog action={removeMemberAction.bind(null, workspaceId, member.membershipId)} openLabel={TEAM_COPY.leave.open} openVariant="danger" title={TEAM_COPY.leave.title} confirmLabel={TEAM_COPY.leave.confirm} confirmVariant="danger" cancelLabel={TEAM_COPY.leave.cancel}>
                          <p className="m-0 text-app-muted">{TEAM_COPY.leave.warning}</p>
                        </ConfirmDialog>
                      ) : (
                        <ConfirmDialog action={removeMemberAction.bind(null, workspaceId, member.membershipId)} openLabel={TEAM_COPY.remove.open} openAriaLabel={TEAM_COPY.remove.openFor(name)} openVariant="danger" title={TEAM_COPY.remove.title} confirmLabel={TEAM_COPY.remove.confirm} confirmVariant="danger" cancelLabel={TEAM_COPY.remove.cancel}>
                          <p className="m-0 text-app-muted">{TEAM_COPY.remove.warning(name)}</p>
                        </ConfirmDialog>
                      )
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <details className="text-sm text-app-muted">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-bold text-app-accent">{TEAM_COPY.roleHelpTitle}</summary>
          <ul className="m-0 mt-2 grid list-disc gap-1 pl-5">{WORKSPACE_ROLES.map((role) => <li key={role}>{TEAM_COPY.roleHelp[role]}</li>)}</ul>
        </details>
      </section>

      {canInvite ? (
        <>
          <section className="surface-card grid gap-4 p-5 sm:p-8" aria-labelledby="invite-title">
            <h2 id="invite-title" className="text-xl font-bold">{TEAM_COPY.invite.title}</h2>
            {seats.reached ? <Notice tone="warning">{TEAM_COPY.limitReached(seats.limit)}</Notice> : (
              <>
                <p className="m-0 text-app-muted">{TEAM_COPY.invite.lead}</p>
                <InviteMemberForm action={inviteMemberAction.bind(null, workspaceId, seats.limit)} roles={INVITABLE_ROLES} />
              </>
            )}
          </section>

          <section className="surface-card grid gap-4 p-5 sm:p-8" aria-labelledby="invitations-title">
            <h2 id="invitations-title" className="text-xl font-bold">{TEAM_COPY.invitations.title}</h2>
            {listed.length === 0 ? <p className="m-0 text-app-muted">{TEAM_COPY.invitations.empty}</p> : (
              <ul className="m-0 grid list-none gap-4 p-0">
                {listed.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-4 first:border-t-0 first:pt-0">
                    <div className="min-w-0">
                      <p className="m-0 break-all font-bold">{invitation.email}</p>
                      <p className="m-0 text-sm text-app-muted">
                        {APP_COPY.roles[invitation.role]} · {invitation.status === "pending" ? TEAM_COPY.invitations.status.pending(formatDateTime(invitation.expiresAt)) : TEAM_COPY.invitations.status[invitation.status]}
                      </p>
                    </div>
                    {invitation.status === "pending" ? (
                      <ConfirmDialog action={revokeInvitationAction.bind(null, workspaceId, invitation.id)} openLabel={TEAM_COPY.invitations.revoke.open} openAriaLabel={TEAM_COPY.invitations.revoke.openFor(invitation.email)} title={TEAM_COPY.invitations.revoke.title} confirmLabel={TEAM_COPY.invitations.revoke.confirm} confirmVariant="danger" cancelLabel={TEAM_COPY.invitations.revoke.keep}>
                        <p className="m-0 text-app-muted">{TEAM_COPY.invitations.revoke.warning(invitation.email)}</p>
                      </ConfirmDialog>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : <p className="m-0 text-app-muted">{TEAM_COPY.viewOnly}</p>}
    </div>
  );
}
