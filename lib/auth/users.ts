import "server-only";

import type { User } from "@prisma/client";

/**
 * Safe user projection for application use.
 * Never include passwordHash or other secrets.
 */
export type SafeUser = {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: Date | null;
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  emailVerifiedAt: true,
  sessionVersion: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function toSafeUser(
  user: Pick<
    User,
    | "id"
    | "name"
    | "email"
    | "emailVerifiedAt"
    | "sessionVersion"
    | "createdAt"
    | "updatedAt"
  >,
): SafeUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    sessionVersion: user.sessionVersion,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
