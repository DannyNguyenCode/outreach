import { describe, expect, it } from "vitest";

import {
  assignCitationKeys,
  checksumFromDraft,
  computeKnowledgeChecksum,
  confirmKnowledgeSchema,
  createManualKnowledgeSchema,
  sanitizeSearchQuery,
  toCanonicalContent,
  updateKnowledgeDraftSchema,
} from "@/lib/orgs/knowledge-validation";
import {
  KNOWLEDGE_CONFIRMATION_LANGUAGE_VERSION,
  KNOWLEDGE_CONFIRMATION_STATEMENT,
} from "@/lib/orgs/knowledge-confirmation";
import { resolveEffectiveRange } from "@/lib/time/organization-datetime";

const sample = {
  title: "Return policy",
  effectiveFrom: null,
  effectiveUntil: null,
  sections: [
    {
      citationKey: "sec_overview",
      title: "Overview",
      passages: [{ citationKey: "pas_body", body: "30 day returns." }],
    },
  ],
};

describe("knowledge confirmation language", () => {
  it("exposes a stable server-controlled statement and version", () => {
    expect(KNOWLEDGE_CONFIRMATION_LANGUAGE_VERSION).toBe(
      "knowledge.confirm.v1",
    );
    expect(KNOWLEDGE_CONFIRMATION_STATEMENT).toMatch(/authorized/i);
    expect(KNOWLEDGE_CONFIRMATION_STATEMENT).toMatch(/accuracy/i);
    expect(KNOWLEDGE_CONFIRMATION_STATEMENT).not.toMatch(/I, the browser/i);
  });

  it("requires an explicit confirmation flag", () => {
    expect(confirmKnowledgeSchema.safeParse({}).success).toBe(false);
    expect(
      confirmKnowledgeSchema.safeParse({
        sourceId: "src",
        versionId: "ver",
        expectedDraftRevision: "0",
        expectedChecksum: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      confirmKnowledgeSchema.safeParse({
        sourceId: "src",
        versionId: "ver",
        expectedDraftRevision: "0",
        expectedChecksum: "a".repeat(64),
        confirmAccuracy: "on",
      }).success,
    ).toBe(true);
  });
});

describe("knowledge checksums and citations", () => {
  it("is stable for the same canonical content", () => {
    const first = checksumFromDraft(sample);
    const second = checksumFromDraft(sample);
    expect(first.checksum).toBe(second.checksum);
    expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sections[0]?.citationKey).toBe("sec_overview");
    expect(first.sections[0]?.passages[0]?.citationKey).toBe("pas_body");
  });

  it("changes when passage text changes", () => {
    const original = checksumFromDraft(sample);
    const edited = checksumFromDraft({
      ...sample,
      sections: [
        {
          ...sample.sections[0]!,
          passages: [{ citationKey: "pas_body", body: "14 day returns." }],
        },
      ],
    });
    expect(edited.checksum).not.toBe(original.checksum);
  });

  it("preserves existing citation keys and fills missing ones", () => {
    const sections = assignCitationKeys([
      {
        citationKey: "sec_overview",
        title: "Overview",
        passages: [
          { body: "Hello" },
          { citationKey: "pas_two", body: "World" },
        ],
      },
    ]);
    expect(sections[0]?.citationKey).toBe("sec_overview");
    expect(sections[0]?.passages[1]?.citationKey).toBe("pas_two");
    expect(sections[0]?.passages[0]?.citationKey).toMatch(/^pas_/);
  });

  it("uses ISO timestamps in the canonical payload", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const canonical = toCanonicalContent({
      title: "Policy",
      effectiveFrom: from,
      effectiveUntil: null,
      sections: assignCitationKeys(sample.sections),
    });
    expect(canonical.effectiveFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(computeKnowledgeChecksum(canonical)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("knowledge draft validation", () => {
  it("accepts omitted effective dates as null", () => {
    expect(
      createManualKnowledgeSchema.safeParse({
        title: "Policy",
        sections: sample.sections,
      }).success,
    ).toBe(true);
    expect(
      updateKnowledgeDraftSchema.safeParse({
        title: "Policy",
        sections: sample.sections,
        sourceId: "src",
        versionId: "ver",
        expectedDraftRevision: "0",
      }).success,
    ).toBe(true);
  });

  it("rejects empty sections", () => {
    expect(createManualKnowledgeSchema.safeParse({ title: "X" }).success).toBe(
      false,
    );
  });

  it("rejects inverted effective dates after UTC conversion", () => {
    const inverted = resolveEffectiveRange({
      effectiveFrom: "2026-02-01T00:00:00.000Z",
      effectiveUntil: "2026-01-01T00:00:00.000Z",
      timeZone: "America/Toronto",
    });
    expect(inverted.ok).toBe(false);
  });

  it("strips LIKE wildcards from search queries", () => {
    expect(sanitizeSearchQuery("  30%_return\\  ")).toBe("30 return");
    expect(sanitizeSearchQuery(12)).toBe("");
  });
});
