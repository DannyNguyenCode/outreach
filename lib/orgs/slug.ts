import { z } from "zod";

/** Reserved organization slugs that must never be claimed. */
export const RESERVED_ORGANIZATION_SLUGS = new Set([
  "new",
  "create",
  "admin",
  "api",
  "app",
  "auth",
  "login",
  "logout",
  "register",
  "settings",
  "invite",
  "invitations",
  "org",
  "orgs",
  "organization",
  "organizations",
  "me",
  "null",
  "undefined",
  "www",
  "static",
  "assets",
  "health",
  "status",
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Normalize a candidate slug: trim, lowercase, collapse separators to hyphens,
 * strip leading/trailing hyphens.
 */
export function normalizeOrganizationSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isReservedOrganizationSlug(slug: string): boolean {
  return RESERVED_ORGANIZATION_SLUGS.has(slug);
}

export const organizationNameSchema = z
  .string()
  .trim()
  .min(2, "Organization name must be at least 2 characters.")
  .max(80, "Organization name must be at most 80 characters.");

export const organizationSlugSchema = z
  .string()
  .trim()
  .min(2, "Slug must be at least 2 characters.")
  .max(48, "Slug must be at most 48 characters.")
  .transform((value) => normalizeOrganizationSlug(value))
  .refine((value) => SLUG_PATTERN.test(value), {
    message:
      "Slug may only contain lowercase letters, numbers, and single hyphens.",
  })
  .refine((value) => !isReservedOrganizationSlug(value), {
    message: "That slug is reserved. Choose a different one.",
  });

/**
 * Derive a slug candidate from an organization name.
 */
export function slugFromOrganizationName(name: string): string {
  return normalizeOrganizationSlug(name).slice(0, 48);
}

export const createOrganizationSchema = z.object({
  name: organizationNameSchema,
  slug: organizationSlugSchema.optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
