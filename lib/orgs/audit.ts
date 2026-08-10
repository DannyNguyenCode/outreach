import "server-only";

import type {
  OrganizationAuditAction,
  Prisma,
  PrismaClient,
} from "@prisma/client";

type AuditDb =
  Pick<PrismaClient, "organizationAuditEvent"> | Prisma.TransactionClient;

export type AuditMetadata = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Persist a sensitive organization audit event.
 * Metadata must never include secrets, raw tokens, or full unnecessary PII.
 */
export async function recordOrganizationAuditEvent(
  db: AuditDb,
  input: {
    organizationId: string;
    actorUserId?: string | null;
    action: OrganizationAuditAction;
    metadata?: AuditMetadata;
  },
): Promise<void> {
  const metadata = sanitizeAuditMetadata(input.metadata);
  await db.organizationAuditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      metadata: metadata ?? undefined,
    },
  });
}

function sanitizeAuditMetadata(
  metadata: AuditMetadata | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata) {
    return undefined;
  }
  const cleaned: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    // Block accidental secret-shaped keys.
    if (/token|secret|password|hash|authorization/i.test(key)) {
      continue;
    }
    cleaned[key] = value;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
