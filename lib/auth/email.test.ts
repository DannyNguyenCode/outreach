import { describe, expect, it } from "vitest";

import { emailSchema, normalizeEmail, parseEmail } from "@/lib/auth/email";

describe("email normalization", () => {
  it("trims and lowercases valid emails", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });

  it("accepts valid emails through the schema", () => {
    const result = emailSchema.safeParse("  Alice@Example.com ");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("alice@example.com");
    }
  });

  it("rejects invalid emails", () => {
    expect(parseEmail("not-an-email")).toBeNull();
    expect(parseEmail("")).toBeNull();
    expect(parseEmail("a@")).toBeNull();
  });

  it("treats case variants as the same normalized value", () => {
    expect(normalizeEmail("A@B.COM")).toBe(normalizeEmail("a@b.com"));
  });

  it("handles surrounding whitespace before validation", () => {
    expect(parseEmail("\tperson@example.org\n")).toBe("person@example.org");
  });
});
