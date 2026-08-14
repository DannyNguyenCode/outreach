import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env/server";
import { extractDocument } from "@/lib/orgs/document-extraction";
import {
  getDocumentMalwareScanner,
  getPrivateDocumentStorage,
} from "@/lib/orgs/document-runtime";
import { processNextKnowledgeDocumentJob } from "@/lib/orgs/knowledge-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const env = getServerEnv();
  if (!env.KNOWLEDGE_WORKER_TOKEN) {
    return NextResponse.json(
      { ok: false, message: "Document worker is not configured." },
      { status: 503 },
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!equalSecret(supplied, env.KNOWLEDGE_WORKER_TOKEN)) {
    return NextResponse.json(
      { ok: false, message: "Worker authorization failed." },
      { status: 401 },
    );
  }

  try {
    const storage = getPrivateDocumentStorage();
    const malware = getDocumentMalwareScanner();
    const workerId = `http-worker-${crypto.randomUUID()}`;
    const outcomes = [];
    for (let count = 0; count < 5; count += 1) {
      const result = await processNextKnowledgeDocumentJob({
        workerId,
        dependencies: {
          storage,
          scanner: malware.scanner,
          scannerName: malware.name,
          scannerVersion: malware.version,
          extract: extractDocument,
        },
      });
      if (!result.claimed) break;
      outcomes.push({ jobId: result.jobId, outcome: result.outcome });
    }
    return NextResponse.json({
      ok: true,
      processed: outcomes.length,
      outcomes,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message:
          "The document worker failed safely. Unfinished work remains durable for retry.",
      },
      { status: 503 },
    );
  }
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
