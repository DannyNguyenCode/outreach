import { z } from "zod";

import { emailSchema } from "@/lib/auth/email";
import {
  createOrganizationSchema,
  organizationNameSchema,
  organizationSlugSchema,
} from "@/lib/orgs/slug";

export {
  createOrganizationSchema,
  organizationNameSchema,
  organizationSlugSchema,
};

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(["ADMIN", "MEMBER"]),
});

export const changeMemberRoleSchema = z.object({
  membershipId: z.string().cuid("Invalid membership."),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export const deactivateMemberSchema = z.object({
  membershipId: z.string().cuid("Invalid membership."),
});

export const revokeInvitationSchema = z.object({
  invitationId: z.string().cuid("Invalid invitation."),
});

export const acceptInvitationSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, "Invitation token is required.")
    .max(256, "Invitation token is invalid."),
});

export const selectOrganizationSchema = z.object({
  organizationId: z.string().cuid("Invalid organization."),
});
