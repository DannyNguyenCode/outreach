import { describe, expect, it } from "vitest";

import {
  isExplicitCustomClear,
  namesAreStrongMatch,
  normalizeProspectEmail,
  normalizeProspectPhone,
  normalizeProspectSearchName,
  normalizeProspectWebsite,
  prospectUpdateInputSchema,
  safeWebsiteHref,
  sanitizeSearchQuery,
} from "@/lib/orgs/prospect-validation";

describe("prospect update patch contract", () => {
  it("treats omitted keys as preserve and blank strings as explicit clear", () => {
    const omitted = prospectUpdateInputSchema.safeParse({
      displayName: "New name",
      expectedVersion: 1,
    });
    expect(omitted.success).toBe(true);
    if (omitted.success) {
      expect(omitted.data.displayName).toBe("New name");
      expect(omitted.data.addressLine1).toBeUndefined();
      expect(omitted.data.website).toBeUndefined();
      expect(omitted.data.customValues).toBeUndefined();
    }

    const cleared = prospectUpdateInputSchema.safeParse({
      website: "",
      addressLine1: null,
      locationLabel: "   ",
      expectedVersion: 1,
    });
    expect(cleared.success).toBe(true);
    if (cleared.success) {
      expect(cleared.data.website).toBeNull();
      expect(cleared.data.addressLine1).toBeNull();
      expect(cleared.data.locationLabel).toBeNull();
    }
  });

  it("treats empty custom values as explicit clears", () => {
    expect(isExplicitCustomClear(null)).toBe(true);
    expect(isExplicitCustomClear("")).toBe(true);
    expect(isExplicitCustomClear([])).toBe(true);
    expect(isExplicitCustomClear("kept")).toBe(false);
    expect(isExplicitCustomClear(["a"])).toBe(false);
  });
});

describe("prospect phone normalization", () => {
  it("normalizes Canadian and US numbers to E.164", () => {
    expect(normalizeProspectPhone("4165551234", "CA")).toEqual({
      ok: true,
      value: { displayValue: "4165551234", normalizedValue: "+14165551234" },
    });
    expect(normalizeProspectPhone("+1 (416) 555-1234")).toEqual({
      ok: true,
      value: {
        displayValue: "+1 (416) 555-1234",
        normalizedValue: "+14165551234",
      },
    });
  });

  it("rejects invalid numbers and does not guess a country", () => {
    expect(normalizeProspectPhone("4165551234").ok).toBe(false);
    expect(normalizeProspectPhone("not-a-phone", "CA").ok).toBe(false);
    expect(normalizeProspectPhone("+999123").ok).toBe(false);
  });
});

describe("prospect email normalization", () => {
  it("lowercases the matching form and keeps display case", () => {
    expect(normalizeProspectEmail("  Alex@Example.COM ")).toEqual({
      ok: true,
      value: {
        displayValue: "Alex@Example.COM",
        normalizedValue: "alex@example.com",
      },
    });
  });

  it("rejects invalid syntax and does not treat plus-aliases as equal", () => {
    expect(normalizeProspectEmail("not-an-email").ok).toBe(false);
    const dotted = normalizeProspectEmail("a.b@gmail.com");
    const plus = normalizeProspectEmail("ab+tag@gmail.com");
    expect(dotted.ok && plus.ok).toBe(true);
    if (dotted.ok && plus.ok) {
      expect(dotted.value.normalizedValue).not.toBe(plus.value.normalizedValue);
    }
  });
});

describe("prospect website normalization", () => {
  it("stores a hostname for matching and rejects unsafe schemes", () => {
    const result = normalizeProspectWebsite("WWW.AbcPlumbing.CA/path");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.normalizedValue).toBe("abcplumbing.ca");
      expect(result.value.displayValue).toBe("WWW.AbcPlumbing.CA/path");
    }
    expect(normalizeProspectWebsite("javascript:alert(1)").ok).toBe(false);
    expect(safeWebsiteHref("javascript:alert(1)")).toBeNull();
    expect(safeWebsiteHref("abcplumbing.ca")?.startsWith("https://")).toBe(
      true,
    );
  });
});

describe("prospect name matching", () => {
  it("treats legal suffixes as the same business name", () => {
    expect(normalizeProspectSearchName("ABC Plumbing Inc.")).toBe(
      "abc plumbing",
    );
    expect(namesAreStrongMatch("ABC Plumbing", "ABC Plumbing Inc.")).toBe(true);
    expect(namesAreStrongMatch("ABC Plumbing", "XYZ Heating")).toBe(false);
  });
});

describe("prospect search sanitization", () => {
  it("strips wildcard characters and bounds length", () => {
    expect(sanitizeSearchQuery("  30%_return\\  ")).toBe("30 return");
    expect(sanitizeSearchQuery("a".repeat(500)).length).toBe(200);
    expect(sanitizeSearchQuery(12)).toBe("");
  });
});
