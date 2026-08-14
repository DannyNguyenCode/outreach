import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getPrivateDocumentStorage } from "@/lib/orgs/document-runtime";
import {
  assertDocumentUploadContentLength,
  DocumentUploadRequestError,
  getDocumentUploadFile,
  parseBoundedDocumentFormData,
} from "@/lib/orgs/document-upload-request";
import {
  DocumentValidationError,
  validateDocument,
} from "@/lib/orgs/document-validation";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import { uploadValidatedKnowledgeDocument } from "@/lib/orgs/knowledge-documents";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    assertDocumentUploadContentLength(request);
  } catch (error) {
    if (error instanceof DocumentUploadRequestError) {
      return uploadRequestError(error);
    }
    throw error;
  }
  const user = await getCurrentUser();
  if (!user || !user.emailVerifiedAt) {
    return NextResponse.json(
      { ok: false, message: "Authentication is required." },
      { status: 401 },
    );
  }
  const { slug } = await context.params;
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
    await requireOrganizationPermission({
      user,
      organizationId: membership.organizationId,
      permission: "org.knowledge.manage",
    });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return NextResponse.json(
        { ok: false, message: "You do not have access to this organization." },
        { status: 404 },
      );
    }
    throw error;
  }

  let formData: FormData;
  try {
    formData = await parseBoundedDocumentFormData(request);
  } catch (error) {
    if (error instanceof DocumentUploadRequestError) {
      return uploadRequestError(error);
    }
    return NextResponse.json(
      { ok: false, message: "The upload request is malformed." },
      { status: 400 },
    );
  }
  let file: File;
  try {
    file = getDocumentUploadFile(formData);
  } catch (error) {
    if (error instanceof DocumentUploadRequestError) {
      return uploadRequestError(error);
    }
    throw error;
  }

  try {
    const validated = await validateDocument({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      declaredMimeType: declaredMimeFromUpload(file),
    });
    const replacementSourceId =
      String(formData.get("replacementSourceId") ?? "").trim() || null;
    const expectedSourceVersion = Number(
      formData.get("expectedSourceVersion") ?? Number.NaN,
    );
    if (
      replacementSourceId &&
      (!Number.isInteger(expectedSourceVersion) || expectedSourceVersion < 0)
    ) {
      return NextResponse.json(
        { ok: false, message: "The replacement request is stale." },
        { status: 409 },
      );
    }
    const result = await uploadValidatedKnowledgeDocument({
      actor: user,
      organizationId: membership.organizationId,
      originalFilename: file.name,
      document: validated,
      storage: getPrivateDocumentStorage(),
      replacement: replacementSourceId
        ? {
            sourceId: replacementSourceId,
            expectedSourceVersion,
          }
        : undefined,
    });
    if (!result.ok) {
      const status =
        result.reason === "forbidden" || result.reason === "not_found"
          ? 404
          : result.reason === "conflict"
            ? 409
            : 400;
      return NextResponse.json(
        { ok: false, message: result.message },
        { status },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        sourceId: result.value.source.id,
        versionId: result.value.version.id,
        processingState: result.value.document.processingState,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      return NextResponse.json(
        { ok: false, code: error.code, message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        message:
          "The private document service is unavailable. No document was activated.",
      },
      { status: 503 },
    );
  }
}

function uploadRequestError(error: DocumentUploadRequestError) {
  return NextResponse.json(
    { ok: false, code: error.code, message: error.message },
    { status: error.status },
  );
}

function declaredMimeFromUpload(file: File): string {
  const declared = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (declared) {
    return declared;
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === "txt") return "text/plain";
  return declared;
}
