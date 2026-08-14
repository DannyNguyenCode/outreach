import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getPrivateDocumentStorage } from "@/lib/orgs/document-runtime";
import { DOCUMENT_MAX_BYTES } from "@/lib/orgs/document-types";
import {
  DocumentValidationError,
  validateDocument,
} from "@/lib/orgs/document-validation";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { uploadValidatedKnowledgeDocument } from "@/lib/orgs/knowledge-documents";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > DOCUMENT_MAX_BYTES + 256 * 1024
  ) {
    return NextResponse.json(
      { ok: false, message: "The upload request is too large." },
      { status: 413 },
    );
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
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, message: "The upload request is malformed." },
      { status: 400 },
    );
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, message: "Choose a PDF, DOCX, or TXT document." },
      { status: 400 },
    );
  }
  if (file.size < 1 || file.size > DOCUMENT_MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        message: `Documents must be between 1 byte and ${DOCUMENT_MAX_BYTES} bytes.`,
      },
      { status: 400 },
    );
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
