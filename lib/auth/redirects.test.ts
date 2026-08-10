import { describe, expect, it } from "vitest";

import { getSafeRedirect, isSafeInternalPath } from "@/lib/auth/redirects";

describe("redirect validation", () => {
  it("accepts allowlisted internal destinations", () => {
    expect(getSafeRedirect("/app")).toBe("/app");
    expect(getSafeRedirect("/login")).toBe("/login");
    expect(isSafeInternalPath("/register")).toBe(true);
    expect(getSafeRedirect("/app/organizations/new")).toBe(
      "/app/organizations/new",
    );
    expect(getSafeRedirect("/app/orgs/acme/members")).toBe(
      "/app/orgs/acme/members",
    );
    expect(getSafeRedirect("/invitations/accept")).toBe("/invitations/accept");
  });

  it("preserves safe invitation tokens in callback URLs", () => {
    expect(getSafeRedirect("/invitations/accept?token=abc_DEF-123")).toBe(
      "/invitations/accept?token=abc_DEF-123",
    );
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
