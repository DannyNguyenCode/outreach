import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/users";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  revokeOrganizationInvitation,
} from "@/lib/orgs/invitations";
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

function createGate() {
  let release!: () => void;
  let reached = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    gate,
    release: () => release(),
    markReached: () => {
      reached = true;
    },
    isReached: () => reached,
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for test seam");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function createVerifiedUser(
  prisma: PrismaClient,
  prefix: string,
  email?: string,
): Promise<SafeUser> {
  const user = await prisma.user.create({
    data: {
      name: prefix,
      email: email ?? `${prefix}-${randomUUID()}@example.com`,
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

describe("invitation authorization and terminal concurrency", () => {
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

  it("rejects invitation issuance after concurrent demotion to MEMBER", async () => {
    const owner = await createVerifiedUser(prisma, "demote-issue-owner");
    const admin = await createVerifiedUser(prisma, "demote-issue-admin");
    const created = await createOrganization(owner, {
      name: "Demote Issue Co",
      slug: `demote-issue-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    await prisma.membership.create({
      data: {
        organizationId: created.organization.id,
        userId: admin.id,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });

    const seam = createGate();
    const invitePromise = createOrganizationInvitation(
      {
        actor: admin,
        organizationId: created.organization.id,
        email: `target-${randomUUID()}@example.com`,
        role: "MEMBER",
      },
      {
        mailer: mockMailer,
        testBeforeTransactionalAuth: async () => {
          seam.markReached();
          await seam.gate;
        },
      },
    );

    await waitUntil(seam.isReached);
    await prisma.membership.update({
      where: {
        organizationId_userId: {
          organizationId: created.organization.id,
          userId: admin.id,
        },
      },
      data: { role: "MEMBER" },
    });
    seam.release();

    const result = await invitePromise;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("forbidden");

    const usable = await prisma.organizationInvitation.count({
      where: {
        organizationId: created.organization.id,
        acceptedAt: null,
        revokedAt: null,
      },
    });
    expect(usable).toBe(0);
    expect(sent).toHaveLength(0);

    const audits = await prisma.organizationAuditEvent.count({
      where: {
        organizationId: created.organization.id,
        action: { in: ["INVITATION_CREATED", "INVITATION_REPLACED"] },
      },
    });
    expect(audits).toBe(0);
  });

  it("rejects invitation issuance after concurrent actor deactivation", async () => {
    const owner = await createVerifiedUser(prisma, "inactive-issue-owner");
    const admin = await createVerifiedUser(prisma, "inactive-issue-admin");
    const created = await createOrganization(owner, {
      name: "Inactive Issue Co",
      slug: `inactive-issue-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    await prisma.membership.create({
      data: {
        organizationId: created.organization.id,
        userId: admin.id,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });

    const seam = createGate();
    const invitePromise = createOrganizationInvitation(
      {
        actor: admin,
        organizationId: created.organization.id,
        email: `target-${randomUUID()}@example.com`,
        role: "MEMBER",
      },
      {
        mailer: mockMailer,
        testBeforeTransactionalAuth: async () => {
          seam.markReached();
          await seam.gate;
        },
      },
    );

    await waitUntil(seam.isReached);
    await prisma.membership.update({
      where: {
        organizationId_userId: {
          organizationId: created.organization.id,
          userId: admin.id,
        },
      },
      data: {
        status: "INACTIVE",
        deactivatedAt: new Date(),
        deactivatedByUserId: owner.id,
      },
    });
    seam.release();

    const result = await invitePromise;
    expect(result.ok).toBe(false);
    expect(sent).toHaveLength(0);
    expect(
      await prisma.organizationInvitation.count({
        where: { organizationId: created.organization.id },
      }),
    ).toBe(0);
  });

  it("rejects invitation revocation after concurrent demotion to MEMBER", async () => {
    const owner = await createVerifiedUser(prisma, "demote-revoke-owner");
    const admin = await createVerifiedUser(prisma, "demote-revoke-admin");
    const created = await createOrganization(owner, {
      name: "Demote Revoke Co",
      slug: `demote-revoke-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    await prisma.membership.create({
      data: {
        organizationId: created.organization.id,
        userId: admin.id,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });

    const invite = await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email: `pending-${randomUUID()}@example.com`,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    if (!invite.ok) throw new Error("invite failed");
    sent.length = 0;

    const seam = createGate();
    const revokePromise = revokeOrganizationInvitation(
      {
        actor: admin,
        organizationId: created.organization.id,
        invitationId: invite.invitationId,
      },
      {
        testBeforeTransactionalAuth: async () => {
          seam.markReached();
          await seam.gate;
        },
      },
    );

    await waitUntil(seam.isReached);
    await prisma.membership.update({
      where: {
        organizationId_userId: {
          organizationId: created.organization.id,
          userId: admin.id,
        },
      },
      data: { role: "MEMBER" },
    });
    seam.release();

    const result = await revokePromise;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("forbidden");

    const row = await prisma.organizationInvitation.findUnique({
      where: { id: invite.invitationId },
    });
    expect(row?.revokedAt).toBeNull();
    expect(row?.acceptedAt).toBeNull();

    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: created.organization.id,
          action: "INVITATION_REVOKED",
        },
      }),
    ).toBe(0);
  });

  it("rejects invitation revocation after concurrent actor deactivation", async () => {
    const owner = await createVerifiedUser(prisma, "inactive-revoke-owner");
    const admin = await createVerifiedUser(prisma, "inactive-revoke-admin");
    const created = await createOrganization(owner, {
      name: "Inactive Revoke Co",
      slug: `inactive-revoke-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    await prisma.membership.create({
      data: {
        organizationId: created.organization.id,
        userId: admin.id,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });

    const invite = await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email: `pending-${randomUUID()}@example.com`,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    if (!invite.ok) throw new Error("invite failed");

    const seam = createGate();
    const revokePromise = revokeOrganizationInvitation(
      {
        actor: admin,
        organizationId: created.organization.id,
        invitationId: invite.invitationId,
      },
      {
        testBeforeTransactionalAuth: async () => {
          seam.markReached();
          await seam.gate;
        },
      },
    );

    await waitUntil(seam.isReached);
    await prisma.membership.update({
      where: {
        organizationId_userId: {
          organizationId: created.organization.id,
          userId: admin.id,
        },
      },
      data: {
        status: "INACTIVE",
        deactivatedAt: new Date(),
        deactivatedByUserId: owner.id,
      },
    });
    seam.release();

    const result = await revokePromise;
    expect(result.ok).toBe(false);

    const row = await prisma.organizationInvitation.findUnique({
      where: { id: invite.invitationId },
    });
    expect(row?.revokedAt).toBeNull();
    expect(row?.acceptedAt).toBeNull();
  });

  it("lets acceptance win over a waiting revocation without contradictory state", async () => {
    const owner = await createVerifiedUser(prisma, "accept-wins-owner");
    const inviteeEmail = `accept-wins-${randomUUID()}@example.com`;
    const invitee = await createVerifiedUser(
      prisma,
      "accept-wins-invitee",
      inviteeEmail,
    );
    const created = await createOrganization(owner, {
      name: "Accept Wins Co",
      slug: `accept-wins-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    const invite = await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email: inviteeEmail,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    if (!invite.ok) throw new Error("invite failed");
    const rawToken = extractToken(sent[0]?.text ?? "");
    expect(rawToken).toBeTruthy();

    const seam = createGate();
    const acceptPromise = acceptOrganizationInvitation(
      { actor: invitee, rawToken: rawToken! },
      {
        testBeforeTerminalMutation: async () => {
          seam.markReached();
          await seam.gate;
        },
      },
    );

    await waitUntil(seam.isReached);

    // Revoke starts while accept holds the terminal lock, so it waits.
    const revokePromise = revokeOrganizationInvitation({
      actor: owner,
      organizationId: created.organization.id,
      invitationId: invite.invitationId,
    });
    seam.release();

    const [accepted, revoked] = await Promise.all([
      acceptPromise,
      revokePromise,
    ]);

    expect(accepted.ok).toBe(true);
    expect(revoked.ok).toBe(false);
    if (revoked.ok) return;
    expect(revoked.reason).toBe("accepted");

    const row = await prisma.organizationInvitation.findUnique({
      where: { id: invite.invitationId },
    });
    expect(row?.acceptedAt).not.toBeNull();
    expect(row?.revokedAt).toBeNull();

    expect(
      await prisma.membership.count({
        where: {
          organizationId: created.organization.id,
          userId: invitee.id,
          status: "ACTIVE",
        },
      }),
    ).toBe(1);

    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: created.organization.id,
          action: "INVITATION_ACCEPTED",
        },
      }),
    ).toBe(1);
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: created.organization.id,
          action: "INVITATION_REVOKED",
        },
      }),
    ).toBe(0);

    const repeatAccept = await acceptOrganizationInvitation({
      actor: invitee,
      rawToken: rawToken!,
    });
    expect(repeatAccept.ok).toBe(true);
    if (repeatAccept.ok) {
      expect(repeatAccept.alreadyMember).toBe(true);
    }

    const repeatRevoke = await revokeOrganizationInvitation({
      actor: owner,
      organizationId: created.organization.id,
      invitationId: invite.invitationId,
    });
    expect(repeatRevoke.ok).toBe(false);
  });

  it("lets revocation win over a waiting acceptance without membership or dual timestamps", async () => {
    const owner = await createVerifiedUser(prisma, "revoke-wins-owner");
    const inviteeEmail = `revoke-wins-${randomUUID()}@example.com`;
    const invitee = await createVerifiedUser(
      prisma,
      "revoke-wins-invitee",
      inviteeEmail,
    );
    const created = await createOrganization(owner, {
      name: "Revoke Wins Co",
      slug: `revoke-wins-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    const invite = await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email: inviteeEmail,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    if (!invite.ok) throw new Error("invite failed");
    const rawToken = extractToken(sent[0]?.text ?? "");
    expect(rawToken).toBeTruthy();

    const seam = createGate();
    const revokePromise = revokeOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        invitationId: invite.invitationId,
      },
      {
        testBeforeTerminalMutation: async () => {
          seam.markReached();
          await seam.gate;
        },
      },
    );

    await waitUntil(seam.isReached);

    const acceptPromise = acceptOrganizationInvitation({
      actor: invitee,
      rawToken: rawToken!,
    });
    seam.release();

    const [revoked, accepted] = await Promise.all([
      revokePromise,
      acceptPromise,
    ]);

    expect(revoked.ok).toBe(true);
    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.reason).toBe("revoked");

    const row = await prisma.organizationInvitation.findUnique({
      where: { id: invite.invitationId },
    });
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.acceptedAt).toBeNull();

    expect(
      await prisma.membership.count({
        where: {
          organizationId: created.organization.id,
          userId: invitee.id,
        },
      }),
    ).toBe(0);

    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: created.organization.id,
          action: "INVITATION_REVOKED",
        },
      }),
    ).toBe(1);
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: created.organization.id,
          action: "INVITATION_ACCEPTED",
        },
      }),
    ).toBe(0);

    const repeatAccept = await acceptOrganizationInvitation({
      actor: invitee,
      rawToken: rawToken!,
    });
    expect(repeatAccept.ok).toBe(false);

    const repeatRevoke = await revokeOrganizationInvitation({
      actor: owner,
      organizationId: created.organization.id,
      invitationId: invite.invitationId,
    });
    expect(repeatRevoke.ok).toBe(false);
  });

  it("rejects cross-tenant invitation revocation without mutating or auditing", async () => {
    const ownerA = await createVerifiedUser(prisma, "tenant-revoke-a");
    const ownerB = await createVerifiedUser(prisma, "tenant-revoke-b");
    const orgA = await createOrganization(ownerA, {
      name: "Tenant A Revoke",
      slug: `tenant-a-revoke-${randomUUID().slice(0, 8)}`,
    });
    const orgB = await createOrganization(ownerB, {
      name: "Tenant B Revoke",
      slug: `tenant-b-revoke-${randomUUID().slice(0, 8)}`,
    });
    if (!orgA.ok || !orgB.ok) throw new Error("org create failed");

    const inviteB = await createOrganizationInvitation(
      {
        actor: ownerB,
        organizationId: orgB.organization.id,
        email: `b-invite-${randomUUID()}@example.com`,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    if (!inviteB.ok) throw new Error("invite failed");

    const result = await revokeOrganizationInvitation({
      actor: ownerA,
      organizationId: orgA.organization.id,
      invitationId: inviteB.invitationId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
    expect(result.message).not.toMatch(/token|hash|organization b/i);

    const row = await prisma.organizationInvitation.findUnique({
      where: { id: inviteB.invitationId },
    });
    expect(row?.revokedAt).toBeNull();
    expect(row?.acceptedAt).toBeNull();

    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: { in: [orgA.organization.id, orgB.organization.id] },
          action: "INVITATION_REVOKED",
        },
      }),
    ).toBe(0);
  });
});
