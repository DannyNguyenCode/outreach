import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}));

import { POST as uploadDocument } from "@/app/api/orgs/[slug]/knowledge/documents/upload/route";
import * as documentUploadRequest from "@/lib/orgs/document-upload-request";
import {
  addMember,
  createOrgWithOwner,
} from "@/tests/integration/helpers/knowledge";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4B document upload route authorization", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
    getCurrentUserMock.mockReset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects a member without org.knowledge.manage before reading the multipart body", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-upload-auth");
    const member = await addMember(
      prisma,
      ctx.organizationId,
      "doc-upload-member",
      "MEMBER",
    );
    getCurrentUserMock.mockResolvedValue(member);

    const parseSpy = vi
      .spyOn(documentUploadRequest, "parseBoundedDocumentFormData")
      .mockImplementation(async () => {
        throw new Error("multipart body was consumed");
      });

    const response = await uploadDocument(
      new Request(
        `http://127.0.0.1/api/orgs/${ctx.slug}/knowledge/documents/upload`,
        {
          method: "POST",
          headers: {
            "content-type": "multipart/form-data; boundary=test-boundary",
            "content-length": "128",
          },
          body: '--test-boundary\r\ncontent-disposition: form-data; name="file"; filename="secret.txt"\r\n\r\nsecret\r\n--test-boundary--\r\n',
        },
      ),
      { params: Promise.resolve({ slug: ctx.slug }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "You do not have access to this organization.",
    });
    expect(parseSpy).not.toHaveBeenCalled();
    parseSpy.mockRestore();
  });
});
