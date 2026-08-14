import type { CanonicalKnowledgeSection } from "@/lib/orgs/knowledge-validation";

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_KINDS = ["pdf", "docx", "txt"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type ValidatedDocument = {
  bytes: Uint8Array;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
};

export type ExtractedDocument = {
  sections: CanonicalKnowledgeSection[];
  sourceSha256: string;
  contentSha256: string;
};
