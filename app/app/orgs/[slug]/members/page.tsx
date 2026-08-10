import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  InviteMemberForm,
  MemberRowActions,
  RevokeInvitationButton,
} from "@/components/orgs/member-management";
import { requireVerifiedUser } from "@/lib/auth/session";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { listOrganizationInvitations } from "@/lib/orgs/invitations";
import { listOrganizationMembers } from "@/lib/orgs/memberships";
import {
  canChangeMemberRole,
  canDeactivateMember,
  roleHasPermission,
} from "@/lib/orgs/permissions";

type MembersPageProps = {
  params: Promise<{ slug: string }>;
};

export const metadata: Metadata = {
  title: "Members",
};

export default async function OrganizationMembersPage({
  params,
}: MembersPageProps) {
  const { slug } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/members`,
  });

  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      notFound();
    }
    throw error;
  }

  const canInvite = roleHasPermission(membership.role, "org.members.invite");
  const canViewInvites = roleHasPermission(
    membership.role,
    "org.invitations.view",
  );

  const members = await listOrganizationMembers({
    actor: user,
    organizationId: membership.organizationId,
  });

  const invitations = canViewInvites
    ? await listOrganizationInvitations({
        actor: user,
        organizationId: membership.organizationId,
      })
    : [];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm text-[var(--muted)]">
          <Link
            href={`/app/orgs/${slug}`}
            className="underline-offset-2 hover:underline"
          >
            ← {membership.organization.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Members & invitations
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Manage who can access this organization. Offboarding deactivates
          membership without deleting accounts.
        </p>
      </div>

      <section className="space-y-3" aria-labelledby="invite-heading">
        <h2 id="invite-heading" className="text-lg font-medium">
          Invite a member
        </h2>
        {canInvite ? (
          <InviteMemberForm organizationSlug={slug} canInvite={canInvite} />
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Only owners and admins can send invitations.
          </p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-lg font-medium">
          Members
        </h2>
        <ul className="divide-y divide-[var(--border)] border border-[var(--border)] bg-[var(--surface)]">
          {members.map((member) => {
            const canManage =
              member.status === "ACTIVE" &&
              canChangeMemberRole({
                actorRole: membership.role,
                actorUserId: user.id,
                targetUserId: member.user.id,
                targetCurrentRole: member.role,
                nextRole: member.role === "ADMIN" ? "MEMBER" : "ADMIN",
              }).ok;
            const canOffboard =
              member.status === "ACTIVE" &&
              canDeactivateMember({
                actorRole: membership.role,
                actorUserId: user.id,
                targetUserId: member.user.id,
                targetRole: member.role,
                targetStatus: member.status,
              }).ok;

            return (
              <li
                key={member.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">{member.user.name}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {member.user.email}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {member.role} · {member.status}
                  </p>
                </div>
                <MemberRowActions
                  organizationSlug={slug}
                  membershipId={member.id}
                  currentRole={member.role}
                  status={member.status}
                  canManage={canManage}
                  canOffboard={canOffboard}
                />
              </li>
            );
          })}
        </ul>
      </section>

      {canViewInvites ? (
        <section className="space-y-3" aria-labelledby="invites-heading">
          <h2 id="invites-heading" className="text-lg font-medium">
            Invitations
          </h2>
          {invitations.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No invitations yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] border border-[var(--border)] bg-[var(--surface)]">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {invitation.emailNormalized}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {invitation.role} · {invitation.status}
                    </p>
                  </div>
                  {invitation.status === "pending" && canInvite ? (
                    <RevokeInvitationButton
                      organizationSlug={slug}
                      invitationId={invitation.id}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
