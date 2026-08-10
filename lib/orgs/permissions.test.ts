import { describe, expect, it } from "vitest";

import {
  canChangeMemberRole,
  canDeactivateMember,
  isInvitableRole,
  roleHasPermission,
} from "@/lib/orgs/permissions";
import {
  isReservedOrganizationSlug,
  normalizeOrganizationSlug,
  organizationSlugSchema,
  slugFromOrganizationName,
} from "@/lib/orgs/slug";

describe("organization slug helpers", () => {
  it("normalizes and validates slugs", () => {
    expect(normalizeOrganizationSlug("  Acme Outreach! ")).toBe(
      "acme-outreach",
    );
    expect(slugFromOrganizationName("Hello World")).toBe("hello-world");
    expect(organizationSlugSchema.safeParse("acme-outreach").success).toBe(
      true,
    );
    expect(organizationSlugSchema.safeParse("Admin").success).toBe(false);
    expect(isReservedOrganizationSlug("login")).toBe(true);
  });
});

describe("organization permissions", () => {
  it("grants owner full Phase 2 management permissions", () => {
    expect(roleHasPermission("OWNER", "org.members.invite")).toBe(true);
    expect(roleHasPermission("OWNER", "org.owner.manage")).toBe(true);
    expect(roleHasPermission("MEMBER", "org.members.invite")).toBe(false);
  });

  it("prevents assigning or changing owner roles", () => {
    expect(
      canChangeMemberRole({
        actorRole: "OWNER",
        actorUserId: "a",
        targetUserId: "b",
        targetCurrentRole: "ADMIN",
        nextRole: "OWNER",
      }).ok,
    ).toBe(false);

    expect(
      canChangeMemberRole({
        actorRole: "ADMIN",
        actorUserId: "a",
        targetUserId: "b",
        targetCurrentRole: "OWNER",
        nextRole: "MEMBER",
      }),
    ).toEqual({ ok: false, reason: "cannot_change_owner" });
  });

  it("allows admin to promote member but not demote admin", () => {
    expect(
      canChangeMemberRole({
        actorRole: "ADMIN",
        actorUserId: "a",
        targetUserId: "b",
        targetCurrentRole: "MEMBER",
        nextRole: "ADMIN",
      }).ok,
    ).toBe(true);

    expect(
      canChangeMemberRole({
        actorRole: "ADMIN",
        actorUserId: "a",
        targetUserId: "b",
        targetCurrentRole: "ADMIN",
        nextRole: "MEMBER",
      }),
    ).toEqual({ ok: false, reason: "cannot_demote_admin" });
  });

  it("blocks owner offboarding and self-offboarding", () => {
    expect(
      canDeactivateMember({
        actorRole: "OWNER",
        actorUserId: "a",
        targetUserId: "b",
        targetRole: "OWNER",
        targetStatus: "ACTIVE",
      }),
    ).toEqual({ ok: false, reason: "cannot_deactivate_owner" });

    expect(
      canDeactivateMember({
        actorRole: "OWNER",
        actorUserId: "a",
        targetUserId: "a",
        targetRole: "MEMBER",
        targetStatus: "ACTIVE",
      }),
    ).toEqual({ ok: false, reason: "cannot_deactivate_self" });
  });

  it("only allows inviting admin or member", () => {
    expect(isInvitableRole("ADMIN")).toBe(true);
    expect(isInvitableRole("MEMBER")).toBe(true);
    expect(isInvitableRole("OWNER")).toBe(false);
  });
});
