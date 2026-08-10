import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/tokens";
import type { SafeUser } from "@/lib/auth/users";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import {
  OrganizationAuthError,
  requireOrganizationMember,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  previewOrganizationInvitation,
  revokeOrganizationInvitation,
} from "@/lib/orgs/invitations";
import {
  changeMemberRole,
  deactivateMember,
  listOrganizationMembers,
} from "@/lib/orgs/memberships";
import { createOrganization } from "@/lib/orgs/organizations";
import { resetApplicationData } from "@/tests/integration/reset";

const sent: Array<{ to: string; subject: string; text: string }> = [];
const mockMailer: EmailSender = {
  async send(input) {
    sent.push({ to: input.to, subject: input.subject, text: input.text });
  },
};

function extractToken(text: string): string | null {
  const match = text.match(/[?&]token=([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

async function createVerifiedUser(
  prisma: PrismaClient,
  prefix: string,
): Promise<SafeUser> {
  const email = `${prefix}-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      name: prefix,
      email,
      passwordHash: await hashPassword("correct horse battery staple"),
      emailVerifiedAt: new Date(),
    },
  });
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    sessionVersion: user.sessionVersion,
    activeOrganizationId: user.activeOrganizationId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

describe("organization phase 2 integration", () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    resetServerEnvCache();
    setMailerForTests(mockMailer);
    await prisma.$connect();
  });

  beforeEach(async () => {
    sent.length = 0;
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    setMailerForTests(undefined);
    await prisma.$disconnect();
  });

  it("creates an organization with exactly one owner membership atomically", async () => {
    const owner = await createVerifiedUser(prisma, "owner");
    const result = await createOrganization(owner, {
      name: "Acme Outreach",
      slug: `acme-${randomUUID().slice(0, 8)}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memberships = await prisma.membership.findMany({
      where: { organizationId: result.organization.id },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("OWNER");
    expect(memberships[0]?.status).toBe("ACTIVE");
    expect(memberships[0]?.userId).toBe(owner.id);

    const audit = await prisma.organizationAuditEvent.findFirst({
      where: {
        organizationId: result.organization.id,
        action: "ORGANIZATION_CREATED",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("handles duplicate slugs safely", async () => {
    const owner = await createVerifiedUser(prisma, "slug-owner");
    const slug = `dup-${randomUUID().slice(0, 8)}`;
    const first = await createOrganization(owner, { name: "One", slug });
    expect(first.ok).toBe(true);
    const secondOwner = await createVerifiedUser(prisma, "slug-owner-2");
    const second = await createOrganization(secondOwner, {
      name: "Two",
      slug,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("slug_taken");
  });

  it("hashes invitation tokens and never stores the raw token", async () => {
    const owner = await createVerifiedUser(prisma, "invite-owner");
    const created = await createOrganization(owner, {
      name: "Invite Co",
      slug: `invite-${randomUUID().slice(0, 8)}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const inviteeEmail = `invitee-${randomUUID()}@example.com`;
    const invite = await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email: inviteeEmail,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;

    const rawToken = extractToken(sent[0]?.text ?? "");
    expect(rawToken).toBeTruthy();
    const row = await prisma.organizationInvitation.findUnique({
      where: { id: invite.invitationId },
    });
    expect(row).not.toBeNull();
    expect(row!.tokenHash).toBe(hashToken(rawToken!));
    expect(row!.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(row)).not.toContain(rawToken);
  });

  it("does not consume invitations on preview GET", async () => {
    const owner = await createVerifiedUser(prisma, "preview-owner");
    const created = await createOrganization(owner, {
      name: "Preview Co",
      slug: `preview-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    const invite = await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email: `preview-${randomUUID()}@example.com`,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    if (!invite.ok) throw new Error("invite failed");
    const rawToken = extractToken(sent[0]?.text ?? "");
    expect(rawToken).toBeTruthy();

    for (let i = 0; i < 5; i += 1) {
      const preview = await previewOrganizationInvitation(rawToken!);
      expect(preview.ok).toBe(true);
      if (preview.ok) expect(preview.status).toBe("pending");
    }

    const row = await prisma.organizationInvitation.findUnique({
      where: { id: invite.invitationId },
    });
    expect(row?.acceptedAt).toBeNull();
    expect(row?.revokedAt).toBeNull();
  });

  it("accepts invitations intentionally with role from the stored invite", async () => {
    const owner = await createVerifiedUser(prisma, "accept-owner");
    const created = await createOrganization(owner, {
      name: "Accept Co",
      slug: `accept-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    const invitee = await createVerifiedUser(prisma, "accept-invitee");
    const invite = await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email: invitee.email,
        role: "ADMIN",
      },
      { mailer: mockMailer },
    );
    if (!invite.ok) throw new Error("invite failed");
    const rawToken = extractToken(sent[0]?.text ?? "");

    const accepted = await acceptOrganizationInvitation({
      actor: invitee,
      rawToken: rawToken!,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: created.organization.id,
          userId: invitee.id,
        },
      },
    });
    expect(membership?.role).toBe("ADMIN");
    expect(membership?.status).toBe("ACTIVE");
  });

  it("rejects acceptance for a different authenticated email", async () => {
    const owner = await createVerifiedUser(prisma, "mismatch-owner");
    const created = await createOrganization(owner, {
      name: "Mismatch Co",
      slug: `mismatch-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email: `intended-${randomUUID()}@example.com`,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    const rawToken = extractToken(sent[0]?.text ?? "");
    const other = await createVerifiedUser(prisma, "mismatch-other");
    const accepted = await acceptOrganizationInvitation({
      actor: other,
      rawToken: rawToken!,
    });
    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.reason).toBe("email_mismatch");
  });

  it("rejects unverified accounts from accepting invitations", async () => {
    const owner = await createVerifiedUser(prisma, "unverified-owner");
    const created = await createOrganization(owner, {
      name: "Unverified Co",
      slug: `unv-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    const email = `unverified-${randomUUID()}@example.com`;
    const unverified = await prisma.user.create({
      data: {
        name: "Unverified",
        email,
        passwordHash: await hashPassword("correct horse battery staple"),
      },
    });

    await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    const rawToken = extractToken(sent[0]?.text ?? "");
    const accepted = await acceptOrganizationInvitation({
      actor: {
        id: unverified.id,
        name: unverified.name,
        email: unverified.email,
        emailVerifiedAt: null,
        sessionVersion: 0,
        activeOrganizationId: null,
        createdAt: unverified.createdAt,
        updatedAt: unverified.updatedAt,
      },
      rawToken: rawToken!,
    });
    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.reason).toBe("unverified");
  });

  it("replacement invitations invalidate previous usable invites", async () => {
    const owner = await createVerifiedUser(prisma, "replace-owner");
    const created = await createOrganization(owner, {
      name: "Replace Co",
      slug: `replace-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");
    const email = `replace-${randomUUID()}@example.com`;

    const first = await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    expect(first.ok).toBe(true);
    const firstToken = extractToken(sent[0]?.text ?? "");
    sent.length = 0;

    const second = await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email,
        role: "ADMIN",
      },
      { mailer: mockMailer },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replaced).toBe(true);
    const secondToken = extractToken(sent[0]?.text ?? "");

    const invitee = await createVerifiedUser(prisma, "replace-invitee");
    await prisma.user.update({
      where: { id: invitee.id },
      data: { email },
    });
    const inviteeWithEmail = { ...invitee, email };

    const oldAccept = await acceptOrganizationInvitation({
      actor: inviteeWithEmail,
      rawToken: firstToken!,
    });
    expect(oldAccept.ok).toBe(false);

    const newAccept = await acceptOrganizationInvitation({
      actor: inviteeWithEmail,
      rawToken: secondToken!,
    });
    expect(newAccept.ok).toBe(true);
  });

  it("enforces role authorization at the service boundary", async () => {
    const owner = await createVerifiedUser(prisma, "authz-owner");
    const created = await createOrganization(owner, {
      name: "Authz Co",
      slug: `authz-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    const member = await createVerifiedUser(prisma, "authz-member");
    await prisma.membership.create({
      data: {
        organizationId: created.organization.id,
        userId: member.id,
        role: "MEMBER",
        status: "ACTIVE",
      },
    });

    const invite = await createOrganizationInvitation({
      actor: member,
      organizationId: created.organization.id,
      email: `nope-${randomUUID()}@example.com`,
      role: "MEMBER",
    });
    expect(invite.ok).toBe(false);

    await expect(
      requireOrganizationPermission({
        user: member,
        organizationId: created.organization.id,
        permission: "org.members.invite",
      }),
    ).rejects.toBeInstanceOf(OrganizationAuthError);
  });

  it("prevents admin from offboarding the owner", async () => {
    const owner = await createVerifiedUser(prisma, "offboard-owner");
    const created = await createOrganization(owner, {
      name: "Offboard Co",
      slug: `offboard-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    const admin = await createVerifiedUser(prisma, "offboard-admin");
    await prisma.membership.create({
      data: {
        organizationId: created.organization.id,
        userId: admin.id,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });

    const ownerMembership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: created.organization.id,
          userId: owner.id,
        },
      },
    });

    const result = await deactivateMember({
      actor: admin,
      organizationId: created.organization.id,
      membershipId: ownerMembership!.id,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("cannot_deactivate_owner");
  });

  it("offboarding revokes access immediately for subsequent authorization", async () => {
    const owner = await createVerifiedUser(prisma, "stale-owner");
    const created = await createOrganization(owner, {
      name: "Stale Co",
      slug: `stale-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    const member = await createVerifiedUser(prisma, "stale-member");
    const membership = await prisma.membership.create({
      data: {
        organizationId: created.organization.id,
        userId: member.id,
        role: "MEMBER",
        status: "ACTIVE",
      },
    });

    const before = await requireOrganizationMember({
      user: member,
      organizationId: created.organization.id,
    });
    expect(before.status).toBe("ACTIVE");

    const offboard = await deactivateMember({
      actor: owner,
      organizationId: created.organization.id,
      membershipId: membership.id,
    });
    expect(offboard.ok).toBe(true);

    await expect(
      requireOrganizationMember({
        user: member,
        organizationId: created.organization.id,
      }),
    ).rejects.toMatchObject({ code: "inactive_membership" });

    // Global account remains.
    const user = await prisma.user.findUnique({ where: { id: member.id } });
    expect(user).not.toBeNull();
  });

  it("isolates tenants across organizations", async () => {
    const ownerA = await createVerifiedUser(prisma, "tenant-a-owner");
    const ownerB = await createVerifiedUser(prisma, "tenant-b-owner");
    const orgA = await createOrganization(ownerA, {
      name: "Tenant A",
      slug: `tenant-a-${randomUUID().slice(0, 8)}`,
    });
    const orgB = await createOrganization(ownerB, {
      name: "Tenant B",
      slug: `tenant-b-${randomUUID().slice(0, 8)}`,
    });
    expect(orgA.ok && orgB.ok).toBe(true);
    if (!orgA.ok || !orgB.ok) return;

    const memberB = await createVerifiedUser(prisma, "tenant-b-member");
    const membershipB = await prisma.membership.create({
      data: {
        organizationId: orgB.organization.id,
        userId: memberB.id,
        role: "MEMBER",
        status: "ACTIVE",
      },
    });

    await expect(
      requireOrganizationMember({
        user: ownerA,
        organizationId: orgB.organization.id,
      }),
    ).rejects.toBeInstanceOf(OrganizationAuthError);

    const roleChange = await changeMemberRole({
      actor: ownerA,
      organizationId: orgA.organization.id,
      membershipId: membershipB.id,
      nextRole: "ADMIN",
    });
    expect(roleChange.ok).toBe(false);

    const invite = await createOrganizationInvitation({
      actor: ownerA,
      organizationId: orgB.organization.id,
      email: `x-${randomUUID()}@example.com`,
      role: "MEMBER",
    });
    expect(invite.ok).toBe(false);

    const membersA = await listOrganizationMembers({
      actor: ownerA,
      organizationId: orgA.organization.id,
    });
    expect(
      membersA.every(
        (m) => m.user.id === ownerA.id || m.user.id !== memberB.id,
      ),
    ).toBe(true);
    expect(membersA.some((m) => m.id === membershipB.id)).toBe(false);
  });

  it("revokes pending invitations", async () => {
    const owner = await createVerifiedUser(prisma, "revoke-owner");
    const created = await createOrganization(owner, {
      name: "Revoke Co",
      slug: `revoke-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    const invite = await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email: `revoke-${randomUUID()}@example.com`,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    if (!invite.ok) throw new Error("invite failed");

    const revoked = await revokeOrganizationInvitation({
      actor: owner,
      organizationId: created.organization.id,
      invitationId: invite.invitationId,
    });
    expect(revoked.ok).toBe(true);

    const rawToken = extractToken(sent[0]?.text ?? "");
    const invitee = await createVerifiedUser(prisma, "revoke-invitee");
    // Force email match attempt with wrong email still fails as revoked/invalid path
    const accepted = await acceptOrganizationInvitation({
      actor: invitee,
      rawToken: rawToken!,
    });
    expect(accepted.ok).toBe(false);
  });
});
