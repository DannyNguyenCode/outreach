import { describe, expect, it } from "vitest";

import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePasswordPolicy,
  verifyPassword,
} from "@/lib/auth/password";

describe("password utilities", () => {
  it("rejects empty and whitespace-only passwords", () => {
    expect(validatePasswordPolicy("")).toBe("empty");
    expect(validatePasswordPolicy("   ")).toBe("whitespace_only");
  });

  it("enforces minimum and maximum length boundaries", () => {
    expect(validatePasswordPolicy("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(
      "too_short",
    );
    expect(validatePasswordPolicy("a".repeat(PASSWORD_MIN_LENGTH))).toBeNull();
    expect(validatePasswordPolicy("a".repeat(PASSWORD_MAX_LENGTH))).toBeNull();
    expect(validatePasswordPolicy("a".repeat(PASSWORD_MAX_LENGTH + 1))).toBe(
      "too_long",
    );
  });

  it("accepts passphrases with spaces", () => {
    expect(validatePasswordPolicy("correct horse battery staple")).toBeNull();
  });

  it("hashes without returning plaintext and verifies correctly", async () => {
    const password = "correct horse battery staple";
    const hashed = await hashPassword(password);
    expect(hashed).not.toContain(password);
    expect(hashed.startsWith("$argon2")).toBe(true);
    expect(await verifyPassword(password, hashed)).toBe(true);
    expect(await verifyPassword("wrong password here", hashed)).toBe(false);
  });

  it("fails verification for empty passwords", async () => {
    const hashed = await hashPassword("a sufficiently long password");
    expect(await verifyPassword("", hashed)).toBe(false);
  });
});
