"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TEAM_COPY } from "@/content/pt-BR";
import { appUrl } from "@/lib/app-url";
import type { FormState } from "@/lib/form-state";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { invitationPath } from "./invitations";
import { getMembersService } from "./members-server";
import type { MemberCommandError, MemberCommandResult } from "./members-service";

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Outcome only: never an address, a token or a path that contains one. */
async function logCommand(event: string, outcome: string): Promise<void> {
  const correlationId = correlationIdFrom((await headers()).get(CORRELATION_HEADER));
  const level = outcome === "ok" || outcome === "accepted" || outcome === "left" ? "info" : outcome === "unavailable" ? "error" : "warn";
  logEvent(level, event, { correlationId, outcome });
}

function errorMessage(error: MemberCommandError, limit?: number): string {
  if (error === "limit_reached") return TEAM_COPY.limitReached(limit ?? 0);
  return TEAM_COPY.errors[error];
}

function failureState<Field extends string = string>(result: Extract<MemberCommandResult<unknown>, { ok: false }>): FormState<Field> {
  return { status: "error", message: errorMessage(result.error), code: result.error };
}

export interface InviteFormState extends FormState<"email" | "role"> {
  /** Present once, right after creation: the only time the link exists outside the invited person's hands. */
  invitation?: { link: string; email: string; expiresAt: string };
}

/**
 * `workspaceId` arrives bound from the page but is client-controlled: the service re-authorizes it
 * against the caller's memberships, and the database function checks the role again.
 */
export async function inviteMemberAction(workspaceId: string, seatLimit: number, _previous: InviteFormState, formData: FormData): Promise<InviteFormState> {
  const values = { email: stringField(formData, "email"), role: stringField(formData, "role") };
  const result = await (await getMembersService()).invite(workspaceId, values);
  await logCommand("members.invite", result.ok ? "ok" : result.error);
  if (!result.ok) {
    const message = errorMessage(result.error, seatLimit);
    return { status: "error", message, values, code: result.error, ...(result.error === "invalid_email" ? { fieldErrors: { email: TEAM_COPY.invite.emailError } } : {}) };
  }
  refresh();
  return {
    status: "success",
    message: TEAM_COPY.invite.created,
    invitation: { link: appUrl(invitationPath(result.value.token)), email: result.value.email, expiresAt: result.value.expiresAt },
  };
}

export async function revokeInvitationAction(workspaceId: string, invitationId: string): Promise<FormState> {
  const result = await (await getMembersService()).revokeInvitation(workspaceId, invitationId);
  await logCommand("members.revoke_invitation", result.ok ? "ok" : result.error);
  if (!result.ok) return failureState(result);
  refresh();
  return { status: "success", message: TEAM_COPY.invitations.revoke.done };
}

export async function changeMemberRoleAction(workspaceId: string, membershipId: string, _previous: FormState, formData: FormData): Promise<FormState> {
  const result = await (await getMembersService()).changeRole(workspaceId, membershipId, stringField(formData, "role"));
  await logCommand("members.change_role", result.ok ? "ok" : result.error);
  if (!result.ok) return failureState(result);
  refresh();
  return { status: "success", message: TEAM_COPY.changeRole.done };
}

/** Removing oneself is leaving: the workspace is gone for this person, so they go back to the start. */
export async function removeMemberAction(workspaceId: string, membershipId: string): Promise<FormState> {
  const result = await (await getMembersService()).remove(workspaceId, membershipId);
  await logCommand("members.remove", result.ok ? (result.value.self ? "left" : "ok") : result.error);
  if (!result.ok) return failureState(result);
  if (result.value.self) redirect("/app?saiu=conta");
  refresh();
  return { status: "success", message: TEAM_COPY.remove.done };
}

export async function acceptInvitationAction(token: string): Promise<FormState> {
  const result = await (await getMembersService()).acceptInvitation(token);
  await logCommand("members.accept_invitation", result.ok ? result.value.outcome : result.error);
  if (!result.ok) return { status: "error", message: result.error === "unauthenticated" ? TEAM_COPY.errors.unauthenticated : TEAM_COPY.accept.unavailable, code: result.error };
  if (result.value.outcome === "accepted" && result.value.workspaceId) redirect(`/app/w/${result.value.workspaceId}?convite=aceito`);
  // Any refusal: render the page again so it shows the state the database reports now.
  refresh();
  return { status: "error", message: TEAM_COPY.accept[result.value.outcome === "accepted" ? "invalid" : result.value.outcome].title, code: result.value.outcome };
}
