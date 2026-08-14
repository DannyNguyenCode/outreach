import { afterEach, describe, expect, it } from "vitest";

import {
  formatOrganizationWallTime,
  parseOrganizationWallTime,
} from "@/lib/time/organization-datetime";

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

describe("organization wall-clock conversion", () => {
  it("converts Toronto winter and summer wall times to UTC", () => {
    const winter = parseOrganizationWallTime({
      value: "2026-01-15T09:00",
      timeZone: "America/Toronto",
    });
    const summer = parseOrganizationWallTime({
      value: "2026-07-15T09:00",
      timeZone: "America/Toronto",
    });
    expect(winter.ok).toBe(true);
    expect(summer.ok).toBe(true);
    if (winter.ok) {
      expect(winter.instant?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
    }
    if (summer.ok) {
      expect(summer.instant?.toISOString()).toBe("2026-07-15T13:00:00.000Z");
    }
  });

  it("rejects a Toronto spring-forward gap", () => {
    const gap = parseOrganizationWallTime({
      value: "2026-03-08T02:30",
      timeZone: "America/Toronto",
    });
    expect(gap.ok).toBe(false);
    if (!gap.ok) {
      expect(gap.code).toBe("dst_gap");
    }
  });

  it("requires an explicit choice for a Toronto fall-back overlap", () => {
    const unspecified = parseOrganizationWallTime({
      value: "2026-11-01T01:30",
      timeZone: "America/Toronto",
    });
    expect(unspecified.ok).toBe(false);
    if (!unspecified.ok) {
      expect(unspecified.code).toBe("dst_overlap");
    }

    const earlier = parseOrganizationWallTime({
      value: "2026-11-01T01:30",
      timeZone: "America/Toronto",
      disambiguation: "earlier",
    });
    const later = parseOrganizationWallTime({
      value: "2026-11-01T01:30",
      timeZone: "America/Toronto",
      disambiguation: "later",
    });
    expect(earlier.ok).toBe(true);
    expect(later.ok).toBe(true);
    if (earlier.ok) {
      expect(earlier.instant?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    }
    if (later.ok) {
      expect(later.instant?.toISOString()).toBe("2026-11-01T06:30:00.000Z");
    }
  });

  it("rejects dated values when the organization timezone is missing", () => {
    const missing = parseOrganizationWallTime({
      value: "2026-01-15T09:00",
      timeZone: null,
      settingsHref: "/app/orgs/demo/settings",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("missing_timezone");
      expect(missing.message).toContain("/app/orgs/demo/settings");
    }
    const undated = parseOrganizationWallTime({
      value: "",
      timeZone: null,
    });
    expect(undated.ok).toBe(true);
    if (undated.ok) {
      expect(undated.instant).toBeNull();
    }
  });

  it("does not depend on process.env.TZ", () => {
    process.env.TZ = "Pacific/Auckland";
    const winter = parseOrganizationWallTime({
      value: "2026-01-15T09:00",
      timeZone: "America/Toronto",
    });
    expect(winter.ok).toBe(true);
    if (winter.ok) {
      expect(winter.instant?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
    }
    const rendered = formatOrganizationWallTime(
      new Date("2026-01-15T14:00:00.000Z"),
      "America/Toronto",
    );
    expect(rendered.wall).toBe("2026-01-15T09:00");
  });
});
