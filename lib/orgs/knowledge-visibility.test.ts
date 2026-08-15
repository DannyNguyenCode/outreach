import { describe, expect, it } from "vitest";

import {
  MEMBER_VISIBLE_INPUT_KINDS,
  MEMBER_VISIBLE_SOURCE_CATEGORY,
  memberVisibleSourceWhere,
  memberVisibleSourceWithVersionWhere,
  memberVisibleVersionWhere,
  memberVisibleVersionWithSourceWhere,
} from "@/lib/orgs/knowledge-visibility";

describe("member-visible knowledge predicates", () => {
  const now = new Date("2026-08-14T16:00:00.000Z");
  const organizationId = "org_member_visible";

  it("requires MANUAL or DOCUMENT customer-confirmed non-archived sources", () => {
    expect(memberVisibleSourceWhere()).toEqual({
      archivedAt: null,
      inputKind: { in: ["MANUAL", "DOCUMENT"] },
      category: "CUSTOMER_CONFIRMED_BUSINESS_FACTS",
    });
    expect(MEMBER_VISIBLE_INPUT_KINDS).toEqual(["MANUAL", "DOCUMENT"]);
    expect(MEMBER_VISIBLE_SOURCE_CATEGORY).toBe(
      "CUSTOMER_CONFIRMED_BUSINESS_FACTS",
    );
  });

  it("retains those source conditions on composed source and version predicates", () => {
    const sourceWhere = memberVisibleSourceWithVersionWhere(
      organizationId,
      now,
    );
    expect(sourceWhere.organizationId).toBe(organizationId);
    expect(sourceWhere.archivedAt).toBeNull();
    expect(sourceWhere.inputKind).toEqual({ in: ["MANUAL", "DOCUMENT"] });
    expect(sourceWhere.category).toBe("CUSTOMER_CONFIRMED_BUSINESS_FACTS");
    expect(sourceWhere.versions).toEqual({
      some: expect.objectContaining({ state: "ACTIVE" }),
    });

    const versionWhere = memberVisibleVersionWithSourceWhere(
      organizationId,
      now,
    );
    expect(versionWhere.organizationId).toBe(organizationId);
    expect(versionWhere.source).toEqual({
      organizationId,
      archivedAt: null,
      inputKind: { in: ["MANUAL", "DOCUMENT"] },
      category: "CUSTOMER_CONFIRMED_BUSINESS_FACTS",
    });
  });

  it("requires CLEAN complete documents for DOCUMENT versions and allows MANUAL", () => {
    const versionWhere = memberVisibleVersionWhere(now);
    expect(versionWhere.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          OR: [
            { source: { inputKind: "MANUAL" } },
            {
              source: { inputKind: "DOCUMENT" },
              document: {
                is: {
                  scanState: "CLEAN",
                  processingState: "COMPLETE",
                },
              },
            },
          ],
        }),
      ]),
    );
  });
});
