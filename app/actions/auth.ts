"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { signIn, signOut } from "@/auth";
import {
  registerUser,
  requestPasswordReset,
  resendVerificationEmail,
  resetPasswordWithToken,
  verifyEmailWithToken,
} from "@/lib/auth/account-service";
import {
  buildRateLimitBucketKey,
  enforceRateLimit,
  resolveClientIp,
  type RateLimitRoute,
} from "@/lib/auth/rate-limit";
import { getSafeRedirect } from "@/lib/auth/redirects";
import { logSecurityEvent } from "@/lib/auth/security-log";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
} from "@/lib/auth/validation";
import { getServerEnv } from "@/lib/env/server";
import { prisma } from "@/lib/prisma";
import type { ActionState } from "@/app/actions/auth-state";

function fieldErrorsFromZod(
  error: import("zod").ZodError,
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string") continue;
    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }
  return fieldErrors;
}

async function rateLimitOrReject(
  route: RateLimitRoute,
  emailNormalized: string | null,
): Promise<ActionState | null> {
  const headerStore = await headers();
  const env = getServerEnv();
  const trustedProxy =
    env.NODE_ENV === "production" || Boolean(env.AUTH_TRUST_HOST);
  const ip = resolveClientIp(headerStore, trustedProxy);

  if (ip.kind === "missing" && !emailNormalized) {
    return {
      status: "rate_limited",
      message: "Too many requests. Please try again later.",
    };
  }

  const bucketKey = buildRateLimitBucketKey({
    route,
    emailNormalized,
    ip,
    missingIpSalt: emailNormalized ?? undefined,
  });

  const decision = await enforceRateLimit(prisma, { route, bucketKey });
  if (!decision.ok) {
    logSecurityEvent({
      event: "auth.rate_limited",
      route,
    });
    return {
      status: "rate_limited",
      message: "Too many requests. Please try again later.",
    };
  }
  return null;
}

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const limited = await rateLimitOrReject("register", parsed.data.email);
  if (limited) return limited;

  const result = await registerUser(parsed.data);

  // Enumeration-resistant: conflict looks like success.
  if (result.status === "ok" || result.status === "conflict") {
    return {
      status: "success",
      message:
        "If the email can receive mail, a verification link has been sent. Check your inbox to continue.",
    };
  }

  return {
    status: "error",
    message: "Unable to complete registration. Please try again.",
  };
}

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const limited = await rateLimitOrReject("login", parsed.data.email);
  if (limited) return limited;

  const callbackUrl = getSafeRedirect(
    String(formData.get("callbackUrl") ?? "/app"),
    "/app",
  );

  try {
    const result = await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });

    if (result?.code === "email_not_verified") {
      return {
        status: "unverified",
        message:
          "Verify your email before signing in. You can request a new verification link below.",
      };
    }

    if (result?.error) {
      return {
        status: "error",
        message: "Invalid email or password.",
      };
    }

    redirect(callbackUrl);
  } catch (error) {
    if (error instanceof AuthError) {
      const code =
        "code" in error && typeof error.code === "string" ? error.code : "";
      if (code === "email_not_verified") {
        return {
          status: "unverified",
          message:
            "Verify your email before signing in. You can request a new verification link below.",
        };
      }
      return {
        status: "error",
        message: "Invalid email or password.",
      };
    }
    // Next.js redirect throws; rethrow so navigation proceeds.
    throw error;
  }
}

export async function logoutAction(): Promise<void> {
  logSecurityEvent({ event: "auth.logout" });
  await signOut({ redirectTo: "/login" });
}

export async function forgotPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const limited = await rateLimitOrReject("forgot-password", parsed.data.email);
  if (limited) return limited;

  await requestPasswordReset(parsed.data.email);

  return {
    status: "success",
    message:
      "If an account exists for that email, password reset instructions have been sent.",
  };
}

export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const headerStore = await headers();
  const env = getServerEnv();
  const trustedProxy =
    env.NODE_ENV === "production" || Boolean(env.AUTH_TRUST_HOST);
  const ip = resolveClientIp(headerStore, trustedProxy);
  const bucketKey = buildRateLimitBucketKey({
    route: "reset-password",
    ip,
    // Token prefix HMAC salt isolates attempts when IP headers are absent.
    missingIpSalt: `token:${parsed.data.token.slice(0, 16)}`,
  });
  const decision = await enforceRateLimit(prisma, {
    route: "reset-password",
    bucketKey,
  });
  if (!decision.ok) {
    logSecurityEvent({ event: "auth.rate_limited", route: "reset-password" });
    return {
      status: "rate_limited",
      message: "Too many requests. Please try again later.",
    };
  }

  const result = await resetPasswordWithToken({
    rawToken: parsed.data.token,
    password: parsed.data.password,
  });

  if (result.status === "ok") {
    return {
      status: "success",
      message:
        "Your password has been updated. You can sign in with the new password.",
    };
  }

  if (result.status === "expired") {
    return {
      status: "error",
      message: "This reset link has expired. Request a new one.",
    };
  }

  return {
    status: "error",
    message: "This reset link is invalid or has already been used.",
  };
}

export async function resendVerificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resendVerificationSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const limited = await rateLimitOrReject(
    "resend-verification",
    parsed.data.email,
  );
  if (limited) return limited;

  await resendVerificationEmail(parsed.data.email);

  return {
    status: "success",
    message:
      "If an unverified account exists for that email, a new verification link has been sent.",
  };
}

export async function consumeVerificationTokenAction(
  token: string,
): Promise<
  "verified" | "already_verified" | "invalid" | "expired" | "consumed"
> {
  const result = await verifyEmailWithToken(token);
  return result.status;
}
