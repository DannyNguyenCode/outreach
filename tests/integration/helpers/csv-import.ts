import { readFileSync } from "node:fs";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { stageCsvImport } from "@/lib/orgs/csv-import";
import {
  getCsvMappingRegistry,
  type CsvMappingInput,
  type CsvMappingTargetFamily,
} from "@/lib/orgs/tabular-mapping";
import { CSV_MIME, csvBytes } from "@/tests/helpers/tabular-fixtures";

export {
  addMember,
  createGate,
  createOrgWithOwner,
  createUnverifiedActor,
  createVerifiedActor,
} from "@/tests/integration/helpers/config-3b";

const TEMPLATE_DIR = path.join(process.cwd(), "public/templates");

export function officialTemplateBytes(family: CsvMappingTargetFamily) {
  const filename =
    family === "knowledge"
      ? "outreach-knowledge-import-template.csv"
      : "outreach-offering-import-template.csv";
  return {
    filename,
    bytes: csvBytes(readFileSync(path.join(TEMPLATE_DIR, filename), "utf8")),
    mapping: mappingFromRegistry(family),
    mimeType: CSV_MIME,
  };
}

export function mappingFromRegistry(
  family: CsvMappingTargetFamily,
): CsvMappingInput {
  return {
    family,
    columns: getCsvMappingRegistry(family).map((field, index) => ({
      sourceColumn: index + 1,
      target: field.id,
    })),
  };
}

export function knowledgeCsvBytes(
  rows: Array<[string, string, string]> = [
    ["Return policy", "Overview", "Customers may return unused items."],
  ],
) {
  return csvBytes(
    ["Title,Section,Body", ...rows.map((row) => row.join(","))].join("\n") +
      "\n",
  );
}

export function knowledgeMapping(): CsvMappingInput {
  return {
    family: "knowledge",
    columns: [
      { sourceColumn: 1, target: "knowledge.title" },
      { sourceColumn: 2, target: "knowledge.sectionTitle" },
      { sourceColumn: 3, target: "knowledge.passageBody" },
    ],
  };
}

export function offeringCsvBytes(
  rows: Array<[string, string, string, string, string, string]> = [
    ["Weekday desk", "PRODUCT", "FIXED_ONE_TIME", "25.00", "USD", "ONE_TIME"],
  ],
) {
  return csvBytes(
    [
      "Name,Type,Pricing model,Amount,Currency,Frequency",
      ...rows.map((row) => row.join(",")),
    ].join("\n") + "\n",
  );
}

export function offeringMapping(): CsvMappingInput {
  return {
    family: "offering",
    columns: [
      { sourceColumn: 1, target: "offering.name" },
      { sourceColumn: 2, target: "offering.offeringType" },
      { sourceColumn: 3, target: "offering.pricingModel" },
      { sourceColumn: 4, target: "offering.priceAmount" },
      { sourceColumn: 5, target: "offering.priceCurrency" },
      { sourceColumn: 6, target: "offering.billingFrequency" },
    ],
  };
}

export async function stageOfficialKnowledge(
  actor: SafeUser,
  organizationId: string,
) {
  const template = officialTemplateBytes("knowledge");
  const result = await stageCsvImport({
    actor,
    organizationId,
    bytes: template.bytes,
    filename: template.filename,
    declaredMimeType: template.mimeType,
    mapping: template.mapping,
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result;
}

export async function countCsvImportAudits(
  prisma: PrismaClient,
  organizationId: string,
) {
  return prisma.organizationAuditEvent.count({
    where: { organizationId, action: "CSV_IMPORT_STAGED" },
  });
}

export async function countCsvActivationAudits(
  prisma: PrismaClient,
  organizationId: string,
) {
  return prisma.organizationAuditEvent.count({
    where: { organizationId, action: "CSV_IMPORT_ACTIVATED" },
  });
}

export async function seedOrganizationTimeZone(
  prisma: PrismaClient,
  organizationId: string,
  timeZone = "America/Toronto",
) {
  await prisma.businessProfile.upsert({
    where: { organizationId },
    create: { organizationId, timeZone },
    update: { timeZone },
  });
}

export async function countDomainEntities(
  prisma: PrismaClient,
  organizationId: string,
) {
  const [
    knowledgeSources,
    knowledgeVersions,
    offerings,
    offeringVersions,
    documents,
    jobs,
    issues,
  ] = await Promise.all([
    prisma.knowledgeSource.count({ where: { organizationId } }),
    prisma.knowledgeVersion.count({ where: { organizationId } }),
    prisma.offering.count({ where: { organizationId } }),
    prisma.offeringVersion.count({ where: { organizationId } }),
    prisma.knowledgeDocument.count({ where: { organizationId } }),
    prisma.knowledgeDocumentJob.count({ where: { organizationId } }),
    prisma.knowledgeDocumentIssue.count({ where: { organizationId } }),
  ]);
  return {
    knowledgeSources,
    knowledgeVersions,
    offerings,
    offeringVersions,
    documents,
    jobs,
    issues,
  };
}
