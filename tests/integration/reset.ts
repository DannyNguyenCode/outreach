import { PrismaClient } from "@prisma/client";

/**
 * Wipe Phase 1 + Phase 2 tables in FK-safe order for integration tests.
 */
export async function resetApplicationData(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.user.updateMany({ data: { activeOrganizationId: null } });
  await prisma.organizationAuditEvent.deleteMany();
  await prisma.organizationInvitation.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.authToken.deleteMany();
  await prisma.rateLimitBucket.deleteMany();
  await prisma.user.deleteMany();
}
