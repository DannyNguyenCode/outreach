import "server-only";

import { Prisma } from "@prisma/client";

import { normalizeEmail } from "@/lib/auth/email";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  emailDomain,
  logSecurityEvent,
  userIdPrefix,
} from "@/lib/auth/security-log";
import { findAuthToken, issueAuthToken } from "@/lib/auth/tokens";
import { safeUserSelect, toSafeUser, type SafeUser } from "@/lib/auth/users";
import {
  getMailer,
  sendPasswordResetEmail,
  sendVerificationEmail,
  type EmailSender,
} from "@/lib/email/mailer";
import { prisma } from "@/lib/prisma";

export type RegisterResult =
  | { status: "ok" }
  | { status: "validation_error"; message: string }
  | { status: "conflict" }
  | { status: "error" };

export async function registerUser(
  input: {
    name: string;
    email: string;
    password: string;
  },
  deps: { mailer?: EmailSender } = {},
): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  const mailer = deps.mailer ?? getMailer();

  logSecurityEvent({
    event: "auth.register_requested",
    emailDomain: emailDomain(email),
    route: "register",
  });

  try {
    const passwordHash = await hashPassword(input.password);

    const user = await prisma.user.create({
      data: {
        name: input.name.trim(),
        email,
        passwordHash,
      },
      select: { id: true, email: true },
    });

    const { rawToken } = await issueAuthToken(prisma, {
      userId: user.id,
      purpose: "EMAIL_VERIFICATION",
    });

    try {
      await sendVerificationEmail(mailer, { to: user.email, rawToken });
    } catch {
      // Account exists; verification can be resent. Do not leak delivery failures.
      logSecurityEvent({
        event: "auth.register_completed",
        userIdPrefix: userIdPrefix(user.id),
        emailDomain: emailDomain(email),
        reason: "email_send_failed",
      });
    }

    logSecurityEvent({
      event: "auth.register_completed",
      userIdPrefix: userIdPrefix(user.id),
      emailDomain: emailDomain(email),
    });

    return { status: "ok" };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { status: "conflict" };
    }
    return { status: "error" };
  }
}

export type VerifyEmailResult =
  | { status: "verified" }
  | { status: "already_verified" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "consumed" };

export async function verifyEmailWithToken(
  rawToken: string,
): Promise<VerifyEmailResult> {
  const found = await findAuthToken(prisma, {
    rawToken,
    purpose: "EMAIL_VERIFICATION",
  });

  if (!found.ok) {
    if (found.reason === "expired") return { status: "expired" };
    if (found.reason === "consumed") return { status: "consumed" };
    return { status: "invalid" };
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: found.userId },
      select: { id: true, emailVerifiedAt: true, email: true },
    });
    if (!user) {
      return { status: "invalid" as const };
    }
    if (user.emailVerifiedAt) {
      await tx.authToken.updateMany({
        where: { id: found.tokenId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return {
        status: "already_verified" as const,
        email: user.email,
        userId: user.id,
      };
    }

    const consume = await tx.authToken.updateMany({
      where: {
        id: found.tokenId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consume.count !== 1) {
      return { status: "consumed" as const };
    }

    await tx.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });

    return { status: "verified" as const, email: user.email, userId: user.id };
  });

  if (result.status === "verified" || result.status === "already_verified") {
    logSecurityEvent({
      event: "auth.verification_completed",
      userIdPrefix: userIdPrefix(result.userId),
      emailDomain: emailDomain(result.email),
      reason: result.status,
    });
  }

  return { status: result.status };
}

export async function resendVerificationEmail(
  emailInput: string,
  deps: { mailer?: EmailSender } = {},
): Promise<{ status: "ok" }> {
  const email = normalizeEmail(emailInput);
  const mailer = deps.mailer ?? getMailer();

  logSecurityEvent({
    event: "auth.verification_resend_requested",
    emailDomain: emailDomain(email),
  });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, emailVerifiedAt: true },
  });

  if (user && !user.emailVerifiedAt) {
    const { rawToken } = await issueAuthToken(prisma, {
      userId: user.id,
      purpose: "EMAIL_VERIFICATION",
    });
    try {
      await sendVerificationEmail(mailer, { to: user.email, rawToken });
    } catch {
      // Generic response regardless of delivery outcome.
    }
  }

  return { status: "ok" };
}

export async function requestPasswordReset(
  emailInput: string,
  deps: { mailer?: EmailSender } = {},
): Promise<{ status: "ok" }> {
  const email = normalizeEmail(emailInput);
  const mailer = deps.mailer ?? getMailer();

  logSecurityEvent({
    event: "auth.password_reset_requested",
    emailDomain: emailDomain(email),
  });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, emailVerifiedAt: true },
  });

  // Only send for verified accounts to avoid amplifying unverified spam targets.
  if (user?.emailVerifiedAt) {
    const { rawToken } = await issueAuthToken(prisma, {
      userId: user.id,
      purpose: "PASSWORD_RESET",
    });
    try {
      await sendPasswordResetEmail(mailer, { to: user.email, rawToken });
    } catch {
      // Still return generic success.
    }
  }

  return { status: "ok" };
}

export type ResetPasswordResult =
  | { status: "ok" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "consumed" }
  | { status: "error" };

export async function resetPasswordWithToken(input: {
  rawToken: string;
  password: string;
}): Promise<ResetPasswordResult> {
  const found = await findAuthToken(prisma, {
    rawToken: input.rawToken,
    purpose: "PASSWORD_RESET",
  });

  if (!found.ok) {
    if (found.reason === "expired") return { status: "expired" };
    if (found.reason === "consumed") return { status: "consumed" };
    return { status: "invalid" };
  }

  try {
    const passwordHash = await hashPassword(input.password);

    const outcome = await prisma.$transaction(async (tx) => {
      const consume = await tx.authToken.updateMany({
        where: {
          id: found.tokenId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (consume.count !== 1) {
        return "consumed" as const;
      }

      await tx.authToken.updateMany({
        where: {
          userId: found.userId,
          purpose: "PASSWORD_RESET",
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });

      await tx.user.update({
        where: { id: found.userId },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 },
        },
      });

      return "ok" as const;
    });

    if (outcome === "consumed") {
      return { status: "consumed" };
    }

    logSecurityEvent({
      event: "auth.password_reset_completed",
      userIdPrefix: userIdPrefix(found.userId),
    });
    logSecurityEvent({
      event: "auth.session_revoked",
      userIdPrefix: userIdPrefix(found.userId),
      reason: "password_reset",
    });

    return { status: "ok" };
  } catch {
    return { status: "error" };
  }
}

export type CredentialCheckResult =
  | { status: "ok"; user: SafeUser }
  | { status: "invalid" }
  | { status: "unverified"; userId: string };

/**
 * Authenticate email/password without revealing whether the account exists.
 * Unverified accounts return a distinct status for a safe user-facing message.
 */
export async function verifyCredentials(input: {
  email: string;
  password: string;
}): Promise<CredentialCheckResult> {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({
    where: { email },
  });

  // Dummy Argon2id hash used only to keep missing-account verification work similar.
  const DUMMY_HASH =
    "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  if (!user) {
    await verifyPassword(input.password || "missing-account", DUMMY_HASH);
    return { status: "invalid" };
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    return { status: "invalid" };
  }

  if (!user.emailVerifiedAt) {
    return { status: "unverified", userId: user.id };
  }

  return { status: "ok", user: toSafeUser(user) };
}

export async function getUserById(id: string): Promise<SafeUser | null> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: safeUserSelect,
  });
  return user ? toSafeUser(user) : null;
}

export async function getSessionVersion(
  userId: string,
): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  });
  return user?.sessionVersion ?? null;
}

/**
 * Server-side revocation check used by protected helpers.
 * A JWT is only valid while its embedded sessionVersion matches the database.
 */
export async function isSessionVersionCurrent(
  userId: string,
  sessionVersion: number,
): Promise<boolean> {
  const current = await getSessionVersion(userId);
  return current !== null && current === sessionVersion;
}
