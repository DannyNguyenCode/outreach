import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getSessionVersion } from "@/lib/auth/account-service";
import { getSafeRedirect } from "@/lib/auth/redirects";
import type { SafeUser } from "@/lib/auth/users";
import { getUserById } from "@/lib/auth/account-service";

export type AuthSessionUser = {
  id: string;
  email: string;
  name: string;
  sessionVersion: number;
};

/**
 * Read the current Auth.js session and confirm it has not been revoked.
 * Returns null when unauthenticated, deleted, or revoked.
 */
export async function getCurrentSessionUser(): Promise<AuthSessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || user.sessionVersion < 0) {
    return null;
  }

  const currentVersion = await getSessionVersion(user.id);
  if (currentVersion === null || currentVersion !== user.sessionVersion) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    sessionVersion: user.sessionVersion,
  };
}

export async function getCurrentUser(): Promise<SafeUser | null> {
  const sessionUser = await getCurrentSessionUser();
  if (!sessionUser) {
    return null;
  }
  return getUserById(sessionUser.id);
}

export async function requireAuthenticatedUser(
  options: { returnTo?: string } = {},
): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) {
    const returnTo = getSafeRedirect(options.returnTo, "/app");
    redirect(`/login?callbackUrl=${encodeURIComponent(returnTo)}`);
  }
  return user;
}

export async function requireVerifiedUser(
  options: { returnTo?: string } = {},
): Promise<SafeUser> {
  const user = await requireAuthenticatedUser(options);
  if (!user.emailVerifiedAt) {
    redirect("/verify-email?reason=unverified");
  }
  return user;
}
