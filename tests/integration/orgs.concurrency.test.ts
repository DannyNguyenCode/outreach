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

describe("organization invitation concurrency", () => {
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

  it("concurrent invitation issuance leaves at most one usable invite", async () => {
    const owner = await createVerifiedUser(prisma, "conc-invite-owner");
    const created = await createOrganization(owner, {
      name: "Conc Invite",
      slug: `conc-invite-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");
    const email = `conc-invite-${randomUUID()}@example.com`;

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        createOrganizationInvitation(
          {
            actor: owner,
            organizationId: created.organization.id,
            email,
            role: "MEMBER",
          },
          { mailer: mockMailer },
        ),
      ),
    );

    expect(results.every((r) => r.ok)).toBe(true);

    const usable = await prisma.organizationInvitation.count({
      where: {
        organizationId: created.organization.id,
        emailNormalized: email,
        acceptedAt: null,
        revokedAt: null,
      },
    });
    expect(usable).toBe(1);
  });

  it("concurrent acceptance creates at most one membership", async () => {
    const owner = await createVerifiedUser(prisma, "conc-accept-owner");
    const created = await createOrganization(owner, {
      name: "Conc Accept",
      slug: `conc-accept-${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error("org create failed");

    const email = `conc-accept-${randomUUID()}@example.com`;
    const invitee = await createVerifiedUser(
      prisma,
      "conc-accept-invitee",
      email,
    );

    const invite = await createOrganizationInvitation(
      {
        actor: owner,
        organizationId: created.organization.id,
        email,
        role: "MEMBER",
      },
      { mailer: mockMailer },
    );
    if (!invite.ok) throw new Error("invite failed");
    const rawToken = extractToken(sent[0]?.text ?? "");
    expect(rawToken).toBeTruthy();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        acceptOrganizationInvitation({
          actor: invitee,
          rawToken: rawToken!,
        }),
      ),
    );

    const successes = results.filter((r) => r.ok);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    const membershipCount = await prisma.membership.count({
      where: {
        organizationId: created.organization.id,
        userId: invitee.id,
      },
    });
    expect(membershipCount).toBe(1);

    const acceptedRows = await prisma.organizationInvitation.count({
      where: {
        organizationId: created.organization.id,
        emailNormalized: email,
        acceptedAt: { not: null },
      },
    });
    expect(acceptedRows).toBe(1);
  });
});
