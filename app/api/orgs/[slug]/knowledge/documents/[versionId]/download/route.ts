import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getPrivateDocumentStorage } from "@/lib/orgs/document-runtime";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { createAuthorizedDocumentDownload } from "@/lib/orgs/knowledge-documents";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ slug: string; versionId: string }>;
  },
) {
  const user = await getCurrentUser();
  if (!user || !user.emailVerifiedAt) {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }
  const { slug, versionId } = await context.params;
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return NextResponse.json({ message: "Not found." }, { status: 404 });
    }
    throw error;
  }
  const sourceId = new URL(_request.url).searchParams.get("sourceId") ?? "";
  const storage = getPrivateDocumentStorage();
  const result = await createAuthorizedDocumentDownload({
    actor: user,
    organizationId: membership.organizationId,
    sourceId,
    versionId,
    storage,
  });
  if (!result.ok) {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }
  if (result.url.startsWith("fake-private://")) {
    const bytes = await storage.download({
      organizationId: membership.organizationId,
      key: result.objectKey,
    });
    return new Response(new Blob([bytes.slice().buffer]), {
      status: 200,
      headers: {
        "content-type": result.mimeType,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return NextResponse.redirect(result.url, {
    status: 307,
    headers: {
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
