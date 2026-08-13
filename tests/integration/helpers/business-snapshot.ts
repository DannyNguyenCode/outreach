import type { PrismaClient } from "@prisma/client";

export function createGate() {
  let release!: () => void;
  let reached!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reachedPromise = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return {
    waitUntilReached: () => reachedPromise,
    markReached: reached,
    waitForRelease: () => released,
    release,
  };
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export type AuditProjection = {
  id: string;
  action: string;
  actorUserId: string | null;
  metadata: unknown;
};

export type HourIntervalSnapshot = {
  id: string;
  organizationId: string;
  dayOfWeek: string;
  isClosed: boolean;
  startMinute: number | null;
  endMinute: number | null;
  sortOrder: number;
  customerNote: string | null;
};

export type ProfileSnapshot = {
  id: string;
  organizationId: string;
  legalName: string | null;
  displayName: string | null;
  description: string | null;
  industry: string | null;
  websiteUrl: string | null;
  primaryEmail: string | null;
  primaryPhoneE164: string | null;
  preferredContactMethod: string | null;
  timeZone: string | null;
  businessType: string | null;
  logoUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type PrimaryLocationSnapshot = {
  id: string;
  organizationId: string;
  label: string;
  isPrimary: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SettingsSnapshot = {
  id: string;
  organizationId: string;
  membersCanViewServices: boolean;
  membersCanViewProducts: boolean;
  membersCanViewBusinessInfo: boolean;
  futureCallingAccessDefault: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type OnboardingSnapshot = {
  id: string;
  organizationId: string;
  status: string;
  currentStep: string;
  completedSteps: unknown;
  isConfigurationReady: boolean;
  version: number;
  completedAt: string | null;
  completedByUserId: string | null;
  reopenedAt: string | null;
  reopenedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CatalogueServiceSnapshot = {
  id: string;
  name: string;
  isActive: boolean;
  displayOrder: number;
  organizationId: string;
};

export type CatalogueProductSnapshot = {
  id: string;
  name: string;
  sku: string | null;
  isActive: boolean;
  displayOrder: number;
  organizationId: string;
};

export type BusinessDbSnapshot = {
  organizationId: string;
  profile: ProfileSnapshot | null;
  primaryLocation: PrimaryLocationSnapshot | null;
  settings: SettingsSnapshot | null;
  hours: HourIntervalSnapshot[];
  onboarding: OnboardingSnapshot | null;
  audits: AuditProjection[];
  services: CatalogueServiceSnapshot[];
  products: CatalogueProductSnapshot[];
};

function mapProfile(
  profile: Awaited<ReturnType<PrismaClient["businessProfile"]["findUnique"]>>,
): ProfileSnapshot | null {
  if (!profile) return null;
  return {
    id: profile.id,
    organizationId: profile.organizationId,
    legalName: profile.legalName,
    displayName: profile.displayName,
    description: profile.description,
    industry: profile.industry,
    websiteUrl: profile.websiteUrl,
    primaryEmail: profile.primaryEmail,
    primaryPhoneE164: profile.primaryPhoneE164,
    preferredContactMethod: profile.preferredContactMethod,
    timeZone: profile.timeZone,
    businessType: profile.businessType,
    logoUrl: profile.logoUrl,
    version: profile.version,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function mapPrimaryLocation(
  location: Awaited<ReturnType<PrismaClient["businessLocation"]["findFirst"]>>,
): PrimaryLocationSnapshot | null {
  if (!location) return null;
  return {
    id: location.id,
    organizationId: location.organizationId,
    label: location.label,
    isPrimary: location.isPrimary,
    addressLine1: location.addressLine1,
    addressLine2: location.addressLine2,
    city: location.city,
    region: location.region,
    postalCode: location.postalCode,
    countryCode: location.countryCode,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}

function mapSettings(
  settings: Awaited<
    ReturnType<PrismaClient["organizationSettings"]["findUnique"]>
  >,
): SettingsSnapshot | null {
  if (!settings) return null;
  return {
    id: settings.id,
    organizationId: settings.organizationId,
    membersCanViewServices: settings.membersCanViewServices,
    membersCanViewProducts: settings.membersCanViewProducts,
    membersCanViewBusinessInfo: settings.membersCanViewBusinessInfo,
    futureCallingAccessDefault: settings.futureCallingAccessDefault,
    version: settings.version,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

function mapOnboarding(
  onboarding: Awaited<
    ReturnType<PrismaClient["organizationOnboarding"]["findUnique"]>
  >,
): OnboardingSnapshot | null {
  if (!onboarding) return null;
  return {
    id: onboarding.id,
    organizationId: onboarding.organizationId,
    status: onboarding.status,
    currentStep: onboarding.currentStep,
    completedSteps: onboarding.completedSteps,
    isConfigurationReady: onboarding.isConfigurationReady,
    version: onboarding.version,
    completedAt: toIso(onboarding.completedAt),
    completedByUserId: onboarding.completedByUserId,
    reopenedAt: toIso(onboarding.reopenedAt),
    reopenedByUserId: onboarding.reopenedByUserId,
    createdAt: onboarding.createdAt.toISOString(),
    updatedAt: onboarding.updatedAt.toISOString(),
  };
}

/** Complete authoritative organization snapshot for concurrency integrity checks. */
export async function captureBusinessDbSnapshot(
  prisma: PrismaClient,
  organizationId: string,
): Promise<BusinessDbSnapshot> {
  const [
    profile,
    primaryLocation,
    settings,
    hours,
    onboarding,
    audits,
    services,
    products,
  ] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { organizationId } }),
    prisma.businessLocation.findFirst({
      where: { organizationId, isPrimary: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.organizationSettings.findUnique({ where: { organizationId } }),
    prisma.operatingHourInterval.findMany({
      where: { organizationId },
      orderBy: [{ dayOfWeek: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    }),
    prisma.organizationOnboarding.findUnique({ where: { organizationId } }),
    prisma.organizationAuditEvent.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        action: true,
        actorUserId: true,
        metadata: true,
      },
    }),
    prisma.businessService.findMany({
      where: { organizationId },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        isActive: true,
        displayOrder: true,
        organizationId: true,
      },
    }),
    prisma.businessProduct.findMany({
      where: { organizationId },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        sku: true,
        isActive: true,
        displayOrder: true,
        organizationId: true,
      },
    }),
  ]);

  return {
    organizationId,
    profile: mapProfile(profile),
    primaryLocation: mapPrimaryLocation(primaryLocation),
    settings: mapSettings(settings),
    hours: hours.map((interval) => ({
      id: interval.id,
      organizationId: interval.organizationId,
      dayOfWeek: interval.dayOfWeek,
      isClosed: interval.isClosed,
      startMinute: interval.startMinute,
      endMinute: interval.endMinute,
      sortOrder: interval.sortOrder,
      customerNote: interval.customerNote,
    })),
    onboarding: mapOnboarding(onboarding),
    audits,
    services,
    products,
  };
}

export function countAudit(
  snapshot: BusinessDbSnapshot,
  action: string,
): number {
  return snapshot.audits.filter((event) => event.action === action).length;
}

function omitUpdatedAt<T extends { updatedAt: string }>(
  value: T,
): Omit<T, "updatedAt"> {
  const { updatedAt, ...rest } = value;
  void updatedAt;
  return rest;
}

/** Strip volatile timestamps so unrelated mutations are visible. */
export function normalizeBusinessSnapshot(snapshot: BusinessDbSnapshot): {
  organizationId: string;
  profile: Omit<ProfileSnapshot, "updatedAt"> | null;
  primaryLocation: Omit<PrimaryLocationSnapshot, "updatedAt"> | null;
  settings: Omit<SettingsSnapshot, "updatedAt"> | null;
  hours: HourIntervalSnapshot[];
  onboarding: Omit<OnboardingSnapshot, "updatedAt"> | null;
  audits: AuditProjection[];
  services: CatalogueServiceSnapshot[];
  products: CatalogueProductSnapshot[];
} {
  return {
    organizationId: snapshot.organizationId,
    profile: snapshot.profile ? omitUpdatedAt(snapshot.profile) : null,
    primaryLocation: snapshot.primaryLocation
      ? omitUpdatedAt(snapshot.primaryLocation)
      : null,
    settings: snapshot.settings ? omitUpdatedAt(snapshot.settings) : null,
    hours: snapshot.hours,
    onboarding: snapshot.onboarding ? omitUpdatedAt(snapshot.onboarding) : null,
    audits: snapshot.audits,
    services: snapshot.services,
    products: snapshot.products,
  };
}
