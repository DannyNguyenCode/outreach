import { PrismaClient } from "@prisma/client";

/**
 * Wipe Phase 1–3B tables in FK-safe order for integration tests.
 * Phase 3B child tables are deleted before Organization.
 */
export async function resetApplicationData(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.user.updateMany({ data: { activeOrganizationId: null } });
  await prisma.organizationAuditEvent.deleteMany();

  // Phase 3B (before organization delete)
  await prisma.organizationConfigProgress.deleteMany();
  await prisma.organizationNotificationDefaults.deleteMany();
  await prisma.organizationRecordingConsentPolicy.deleteMany();
  await prisma.organizationCallbackPolicy.deleteMany();
  await prisma.callDispositionDefault.deleteMany();
  await prisma.leadStageDefault.deleteMany();
  await prisma.holidayClosure.deleteMany();
  await prisma.serviceArea.deleteMany();
  await prisma.customFieldDefinition.deleteMany();
  await prisma.organizationLocaleSettings.deleteMany();
  await prisma.organizationTemplateAssignment.deleteMany();

  // Phase 3A
  await prisma.organizationOnboarding.deleteMany();
  await prisma.organizationSettings.deleteMany();
  await prisma.operatingHourInterval.deleteMany();
  await prisma.businessService.deleteMany();
  await prisma.businessProduct.deleteMany();
  await prisma.businessLocation.deleteMany();
  await prisma.businessProfile.deleteMany();

  // Phase 2
  await prisma.organizationInvitation.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.organization.deleteMany();

  // Phase 1
  await prisma.authToken.deleteMany();
  await prisma.rateLimitBucket.deleteMany();
  await prisma.user.deleteMany();
}
