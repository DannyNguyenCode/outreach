import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const requireVerifiedUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireVerifiedUser: (...args: unknown[]) => requireVerifiedUserMock(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
}));

import {
  confirmKnowledgeVersionAction,
  createManualKnowledgeAction,
} from "@/app/actions/knowledge";
import type { ActionState } from "@/app/actions/auth-state";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import {
  createSampleDraft,
  createOrgWithOwner,
} from "@/tests/integration/helpers/knowledge";
import { resetApplicationData } from "@/tests/integration/reset";

const initialState: ActionState = { status: "idle" };
const mockMailer: EmailSender = { async send() {} };

describe("Phase 4A knowledge actions", () => {
  const prisma = new PrismaClient();

  beforeAll(() => {
    resetServerEnvCache();
    setMailerForTests(mockMailer);
  });

  beforeEach(async () => {
    await resetApplicationData(prisma);
    requireVerifiedUserMock.mockReset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a draft through the server action", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-action-create");
    requireVerifiedUserMock.mockResolvedValue(ctx.owner);
    const form = new FormData();
    form.set("organizationSlug", ctx.slug);
    form.set("title", "Hours policy");
    form.set(
      "contentJson",
      JSON.stringify({
        sections: [{ title: "Hours", passages: [{ body: "Open 9 to 5." }] }],
      }),
    );
    const result = await createManualKnowledgeAction(initialState, form);
    expect(result.status).toBe("success");
    const versions = await prisma.knowledgeVersion.findMany({
      where: { organizationId: ctx.organizationId },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]?.state).toBe("DRAFT");
  });

  it("confirms through the server action using server language", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-action-confirm");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    requireVerifiedUserMock.mockResolvedValue(ctx.owner);
    const form = new FormData();
    form.set("organizationSlug", ctx.slug);
    form.set("sourceId", created.source.id);
    form.set("versionId", created.version.id);
    form.set("expectedDraftRevision", String(created.version.draftRevision));
    form.set("expectedChecksum", created.version.contentChecksum);
    form.set("confirmAccuracy", "on");
    const result = await confirmKnowledgeVersionAction(initialState, form);
    expect(result.status).toBe("success");
    const version = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    expect(version.state).toBe("ACTIVE");
    expect(version.confirmationLanguageVersion).toBe("knowledge.confirm.v1");
    expect(version.confirmerUserId).toBe(ctx.owner.id);
  });

  it("rejects confirm when the checkbox is missing", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-action-nocheck");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    requireVerifiedUserMock.mockResolvedValue(ctx.owner);
    const form = new FormData();
    form.set("organizationSlug", ctx.slug);
    form.set("sourceId", created.source.id);
    form.set("versionId", created.version.id);
    form.set("expectedDraftRevision", String(created.version.draftRevision));
    form.set("expectedChecksum", created.version.contentChecksum);
    const result = await confirmKnowledgeVersionAction(initialState, form);
    expect(result.status).toBe("error");
    const version = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    expect(version.state).toBe("DRAFT");
  });
});
