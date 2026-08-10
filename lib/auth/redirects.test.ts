import { describe, expect, it } from "vitest";

import { getSafeRedirect, isSafeInternalPath } from "@/lib/auth/redirects";

describe("redirect validation", () => {
  it("accepts allowlisted internal destinations", () => {
    expect(getSafeRedirect("/app")).toBe("/app");
    expect(getSafeRedirect("/login")).toBe("/login");
    expect(isSafeInternalPath("/register")).toBe(true);
  });

  it("rejects external URLs", () => {
    expect(getSafeRedirect("https://evil.example")).toBe("/app");
    expect(getSafeRedirect("http://evil.example/app")).toBe("/app");
  });

  it("rejects protocol-relative URLs", () => {
    expect(getSafeRedirect("//evil.example")).toBe("/app");
  });

  it("rejects malformed destinations", () => {
    expect(getSafeRedirect("/\\evil")).toBe("/app");
    expect(getSafeRedirect("app")).toBe("/app");
    expect(getSafeRedirect("/dashboard")).toBe("/app");
  });

  it("uses the provided safe fallback", () => {
    expect(getSafeRedirect("https://evil.example", "/login")).toBe("/login");
  });
});
