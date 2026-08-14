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
  archiveKnowledgeSourceAction,
  confirmKnowledgeVersionAction,
  createManualKnowledgeAction,
  createReplacementDraftAction,
  restoreKnowledgeVersionAction,
  updateKnowledgeDraftAction,
} from "@/app/actions/knowledge";
import type { ActionState } from "@/app/actions/auth-state";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import {
  confirmSample,
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

  it("updates a draft, creates a replacement, archives, and restores through actions", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-action-lifecycle");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    requireVerifiedUserMock.mockResolvedValue(ctx.owner);

    const updateForm = new FormData();
    updateForm.set("organizationSlug", ctx.slug);
    updateForm.set("sourceId", created.source.id);
    updateForm.set("versionId", created.version.id);
    updateForm.set(
      "expectedDraftRevision",
      String(created.version.draftRevision),
    );
    updateForm.set("title", "Updated hours policy");
    updateForm.set(
      "contentJson",
      JSON.stringify({
        sections: [{ title: "Hours", passages: [{ body: "Open 8 to 6." }] }],
      }),
    );
    const updated = await updateKnowledgeDraftAction(initialState, updateForm);
    expect(updated.status).toBe("success");

    const afterUpdate = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    const confirmForm = new FormData();
    confirmForm.set("organizationSlug", ctx.slug);
    confirmForm.set("sourceId", created.source.id);
    confirmForm.set("versionId", created.version.id);
    confirmForm.set("expectedDraftRevision", String(afterUpdate.draftRevision));
    confirmForm.set("expectedChecksum", afterUpdate.contentChecksum);
    confirmForm.set("confirmAccuracy", "on");
    expect(
      (await confirmKnowledgeVersionAction(initialState, confirmForm)).status,
    ).toBe("success");

    const source = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: created.source.id },
    });
    const replaceForm = new FormData();
    replaceForm.set("organizationSlug", ctx.slug);
    replaceForm.set("sourceId", created.source.id);
    replaceForm.set("expectedVersion", String(source.version));
    const replaced = await createReplacementDraftAction(
      initialState,
      replaceForm,
    );
    expect(replaced.status).toBe("success");

    const sourceAfterReplace = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: created.source.id },
    });
    const archiveForm = new FormData();
    archiveForm.set("organizationSlug", ctx.slug);
    archiveForm.set("sourceId", created.source.id);
    archiveForm.set("expectedVersion", String(sourceAfterReplace.version));
    expect(
      (await archiveKnowledgeSourceAction(initialState, archiveForm)).status,
    ).toBe("success");

    const archivedVersion = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    expect(archivedVersion.state).toBe("ARCHIVED");

    const sourceAfterArchive = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: created.source.id },
    });
    const restoreForm = new FormData();
    restoreForm.set("organizationSlug", ctx.slug);
    restoreForm.set("sourceId", created.source.id);
    restoreForm.set("versionId", created.version.id);
    restoreForm.set("expectedVersion", String(sourceAfterArchive.version));
    const restored = await restoreKnowledgeVersionAction(
      initialState,
      restoreForm,
    );
    expect(restored.status).toBe("success");
    const drafts = await prisma.knowledgeVersion.findMany({
      where: { sourceId: created.source.id, state: "DRAFT" },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.id).not.toBe(created.version.id);
  });

  it("maps stale OCC and forged ids to safe action errors", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-action-occ");
    const other = await createOrgWithOwner(prisma, "know-action-forged");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    await confirmSample(
      ctx.owner,
      ctx.organizationId,
      created.source.id,
      created.version.id,
      created.version.draftRevision,
      created.version.contentChecksum,
    );
    requireVerifiedUserMock.mockResolvedValue(ctx.owner);

    const stale = new FormData();
    stale.set("organizationSlug", ctx.slug);
    stale.set("sourceId", created.source.id);
    stale.set("expectedVersion", "0");
    const staleResult = await archiveKnowledgeSourceAction(initialState, stale);
    expect(staleResult.status).toBe("error");
    expect(staleResult.message?.toLowerCase()).not.toMatch(/prisma|p20\d{2}/);

    const forged = new FormData();
    forged.set("organizationSlug", ctx.slug);
    forged.set("sourceId", "clkbogus00000000000000000");
    forged.set("expectedVersion", "0");
    const forgedResult = await archiveKnowledgeSourceAction(
      initialState,
      forged,
    );
    expect(forgedResult.status).toBe("error");
    expect(forgedResult.message).toMatch(/not found/i);
    expect(forgedResult.message?.toLowerCase()).not.toMatch(/prisma|p20\d{2}/);

    const crossTenant = new FormData();
    crossTenant.set("organizationSlug", ctx.slug);
    crossTenant.set("sourceId", other.organizationId);
    crossTenant.set("expectedVersion", "0");
    const crossResult = await archiveKnowledgeSourceAction(
      initialState,
      crossTenant,
    );
    expect(crossResult.status).toBe("error");
    expect(crossResult.message?.toLowerCase()).not.toMatch(/prisma|p20\d{2}/);
  });
});
