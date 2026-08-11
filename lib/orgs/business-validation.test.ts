import { describe, expect, it } from "vitest";

import {
  businessBasicsSchema,
  contactLocationSchema,
  intervalsOverlap,
  normalizePhoneNumber,
  safeHttpUrlSchema,
  ianaTimeZoneSchema,
  validateWeeklySchedule,
  serviceInputSchema,
  productInputSchema,
} from "@/lib/orgs/business-validation";
import { roleHasPermission } from "@/lib/orgs/permissions";

describe("Phase 3A business validation", () => {
  it("rejects unsafe URL protocols", () => {
    expect(safeHttpUrlSchema.safeParse("javascript:alert(1)").success).toBe(
      false,
    );
    expect(safeHttpUrlSchema.safeParse("data:text/html,hi").success).toBe(
      false,
    );
    expect(safeHttpUrlSchema.safeParse("https://example.com").success).toBe(
      true,
    );
    expect(safeHttpUrlSchema.safeParse("http://example.com").success).toBe(
      true,
    );
  });

  it("accepts valid IANA time zones and rejects offsets", () => {
    expect(ianaTimeZoneSchema.safeParse("America/Toronto").success).toBe(true);
    expect(ianaTimeZoneSchema.safeParse("UTC").success).toBe(true);
    expect(ianaTimeZoneSchema.safeParse("GMT-5").success).toBe(false);
    expect(ianaTimeZoneSchema.safeParse("Not/AZone").success).toBe(false);
  });

  it("normalizes phone numbers to E.164 with country context", () => {
    const result = normalizePhoneNumber("4165551234", "CA");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.e164).toBe("+14165551234");
    }
    expect(normalizePhoneNumber("+14165551234").ok).toBe(true);
    expect(normalizePhoneNumber("4165551234").ok).toBe(false);
  });

  it("validates business basics and contact schemas", () => {
    expect(
      businessBasicsSchema.safeParse({
        displayName: "Acme Dental",
        industry: "Healthcare",
        businessType: "SERVICES",
        websiteUrl: "https://acme.example",
      }).success,
    ).toBe(true);

    const contact = contactLocationSchema.safeParse({
      primaryEmail: "Info@Acme.Example",
      primaryPhone: "4165551234",
      timeZone: "America/Toronto",
      countryCode: "ca",
      city: "Toronto",
    });
    expect(contact.success).toBe(true);
    if (contact.success) {
      expect(contact.data.primaryEmail).toBe("info@acme.example");
      expect(contact.data.primaryPhoneE164).toBe("+14165551234");
      expect(contact.data.countryCode).toBe("CA");
    }
  });

  it("rejects overlapping and zero-length operating intervals", () => {
    expect(
      intervalsOverlap(
        { startMinute: 540, endMinute: 720 },
        { startMinute: 700, endMinute: 800 },
      ),
    ).toBe(true);
    expect(
      intervalsOverlap(
        { startMinute: 540, endMinute: 720 },
        { startMinute: 720, endMinute: 800 },
      ),
    ).toBe(false);

    const invalid = validateWeeklySchedule(
      [
        "MONDAY",
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
        "SATURDAY",
        "SUNDAY",
      ].flatMap((day) => [
        {
          dayOfWeek: day as never,
          isClosed: false,
          startMinute: 540,
          endMinute: 720,
          sortOrder: 0,
        },
        {
          dayOfWeek: day as never,
          isClosed: false,
          startMinute: 700,
          endMinute: 800,
          sortOrder: 1,
        },
      ]),
    );
    expect(invalid.ok).toBe(false);

    const overnight = validateWeeklySchedule([
      {
        dayOfWeek: "MONDAY",
        isClosed: false,
        startMinute: 1320,
        endMinute: 120,
        sortOrder: 0,
      },
      ...[
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
        "SATURDAY",
        "SUNDAY",
      ].map((day) => ({
        dayOfWeek: day as never,
        isClosed: true,
        startMinute: null,
        endMinute: null,
        sortOrder: 0,
      })),
    ]);
    expect(overnight.ok).toBe(false);
  });

  it("validates service and product inputs", () => {
    expect(
      serviceInputSchema.safeParse({
        name: "Cleaning",
        durationMinutes: 60,
        priceDescription: "Starting at $99",
      }).success,
    ).toBe(true);
    expect(
      serviceInputSchema.safeParse({
        name: "Cleaning",
        durationMinutes: 0,
      }).success,
    ).toBe(false);
    expect(
      productInputSchema.safeParse({
        name: "Widget",
        sku: "WID-1",
      }).success,
    ).toBe(true);
  });
});

describe("Phase 3A permissions", () => {
  it("allows owners and admins to manage business configuration", () => {
    expect(roleHasPermission("OWNER", "org.business.update")).toBe(true);
    expect(roleHasPermission("ADMIN", "org.hours.update")).toBe(true);
    expect(roleHasPermission("ADMIN", "org.onboarding.complete")).toBe(true);
    expect(roleHasPermission("ADMIN", "org.onboarding.reopen")).toBe(true);
  });

  it("denies members manage and onboarding permissions", () => {
    expect(roleHasPermission("MEMBER", "org.business.update")).toBe(false);
    expect(roleHasPermission("MEMBER", "org.services.manage")).toBe(false);
    expect(roleHasPermission("MEMBER", "org.products.manage")).toBe(false);
    expect(roleHasPermission("MEMBER", "org.onboarding.manage")).toBe(false);
    expect(roleHasPermission("MEMBER", "org.onboarding.complete")).toBe(false);
    expect(roleHasPermission("MEMBER", "org.settings.manage")).toBe(false);
    expect(roleHasPermission("MEMBER", "org.business.read")).toBe(true);
    expect(roleHasPermission("MEMBER", "org.services.read")).toBe(true);
  });
});
