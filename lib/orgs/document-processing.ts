import "server-only";

import {
  MalwareDetectedError,
  MalwareScanUnavailableError,
} from "@/lib/orgs/document-malware";
import { DocumentExtractionError } from "@/lib/orgs/document-extraction";
import { DocumentValidationError } from "@/lib/orgs/document-validation";
import type { CanonicalKnowledgeSection } from "@/lib/orgs/knowledge-validation";

const DUPLICATE_MAX_CANDIDATES = 100;
const DUPLICATE_MAX_CHARACTERS = 200_000;
const DUPLICATE_MAX_SHINGLES = 20_000;

export type NearDuplicateCandidate = {
  id: string;
  sections: CanonicalKnowledgeSection[];
};

export type NearDuplicateMatch = {
  id: string;
  similarity: number;
};

export function findNearDuplicates(
  target: CanonicalKnowledgeSection[],
  candidates: NearDuplicateCandidate[],
  options: { threshold?: number; maxResults?: number } = {},
): NearDuplicateMatch[] {
  const threshold = options.threshold ?? 0.85;
  const maxResults = Math.min(Math.max(options.maxResults ?? 10, 0), 25);
  if (threshold < 0 || threshold > 1) {
    throw new Error("Near-duplicate threshold must be between zero and one.");
  }
  const targetFingerprint = fingerprint(target);
  return candidates
    .slice(0, DUPLICATE_MAX_CANDIDATES)
    .map((candidate) => ({
      id: candidate.id,
      similarity: jaccard(targetFingerprint, fingerprint(candidate.sections)),
    }))
    .filter((candidate) => candidate.similarity >= threshold)
    .sort(
      (left, right) =>
        right.similarity - left.similarity || left.id.localeCompare(right.id),
    )
    .slice(0, maxResults);
}

export type RetryClassification =
  | { retryable: true; reason: "timeout" | "rate_limit" | "remote" }
  | {
      retryable: false;
      reason: "aborted" | "validation" | "malware" | "permanent";
    };

export function classifyDocumentProcessingError(
  error: unknown,
): RetryClassification {
  if (
    error instanceof DocumentValidationError ||
    error instanceof DocumentExtractionError
  ) {
    return { retryable: false, reason: "validation" };
  }
  if (error instanceof MalwareDetectedError) {
    return { retryable: false, reason: "malware" };
  }
  if (error instanceof MalwareScanUnavailableError) {
    return { retryable: true, reason: "remote" };
  }
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return error.name === "AbortError"
      ? { retryable: false, reason: "aborted" }
      : { retryable: true, reason: "timeout" };
  }
  const status = httpStatus(error);
  if (status === 408 || status === 425 || status === 429) {
    return {
      retryable: true,
      reason: status === 429 ? "rate_limit" : "timeout",
    };
  }
  if (status !== null && status >= 500 && status <= 599) {
    return { retryable: true, reason: "remote" };
  }
  return { retryable: false, reason: "permanent" };
}

export function documentRetryDelayMs(
  retryNumber: number,
  options: {
    baseMs?: number;
    maxMs?: number;
    jitterRatio?: number;
    random?: () => number;
  } = {},
): number {
  if (!Number.isInteger(retryNumber) || retryNumber < 1) {
    throw new Error("Retry number must be a positive whole number.");
  }
  const base = options.baseMs ?? 500;
  const maximum = options.maxMs ?? 30_000;
  const jitterRatio = options.jitterRatio ?? 0.2;
  if (base < 1 || maximum < base || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error("Retry backoff options are invalid.");
  }
  const exponential = Math.min(maximum, base * 2 ** (retryNumber - 1));
  const random = options.random ?? Math.random;
  const jitter = exponential * jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

function fingerprint(sections: CanonicalKnowledgeSection[]): Set<string> {
  const text = sections
    .flatMap((section) => [
      section.title,
      ...section.passages.map((passage) => passage.body),
    ])
    .join(" ")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, DUPLICATE_MAX_CHARACTERS);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 5) {
    return new Set(text ? [text] : []);
  }
  const shingles = new Set<string>();
  for (
    let index = 0;
    index <= words.length - 5 && shingles.size < DUPLICATE_MAX_SHINGLES;
    index += 1
  ) {
    shingles.add(words.slice(index, index + 5).join(" "));
  }
  return shingles;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return left.size === right.size ? 1 : 0;
  }
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }
  return intersection / (left.size + right.size - intersection);
}

function httpStatus(error: unknown): number | null {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const value = current as {
      status?: unknown;
      statusCode?: unknown;
      cause?: unknown;
    };
    const status = Number(value.status ?? value.statusCode);
    if (Number.isInteger(status)) {
      return status;
    }
    current = "cause" in value ? value.cause : undefined;
  }
  return null;
}
