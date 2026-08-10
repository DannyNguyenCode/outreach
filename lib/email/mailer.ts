import "server-only";

import { Resend } from "resend";

import { emailDomain } from "@/lib/auth/security-log";
import type { ServerEnv } from "@/lib/env/schema";
import { getServerEnv } from "@/lib/env/server";

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailSender = {
  send(input: SendEmailInput): Promise<void>;
};

export class EmailDeliveryError extends Error {
  readonly code: "provider_error" | "provider_rejected" | "timeout";

  constructor(code: EmailDeliveryError["code"], message: string) {
    super(message);
    this.name = "EmailDeliveryError";
    this.code = code;
  }
}

/**
 * Race a provider promise against an application deadline.
 * Clears the timer on settle. The underlying Resend HTTP call may continue
 * after timeout (SDK does not expose a reliable AbortSignal on emails.send in
 * this version); the application stops awaiting it and treats delivery as failed.
 */
export async function withEmailProviderTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new EmailDeliveryError(
              "timeout",
              "Email provider request timed out.",
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function logEmailFailure(input: { code: string; to: string }): void {
  console.error(
    JSON.stringify({
      event: "email.delivery_failed",
      code: input.code,
      emailDomain: emailDomain(input.to),
    }),
  );
}

/**
 * Dedicated Playwright webServer marker. Set only by playwright.config.ts so
 * local `next start` e2e against localhost may use mock delivery.
 */
export const PLAYWRIGHT_WEB_SERVER_ENV = "PLAYWRIGHT_WEB_SERVER";

function isLocalhostAppUrl(appUrl: string): boolean {
  try {
    const { hostname } = new URL(appUrl);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

function isPlaywrightLocalhostEnvironment(env: ServerEnv): boolean {
  return (
    process.env[PLAYWRIGHT_WEB_SERVER_ENV] === "true" &&
    isLocalhostAppUrl(env.NEXT_PUBLIC_APP_URL)
  );
}

/**
 * Whether mock delivery is permitted for this process.
 *
 * Allowed only when:
 * - NODE_ENV is not production, or
 * - CI === "true", or
 * - Playwright webServer is driving a localhost app URL
 *
 * Vercel production always rejects mock delivery.
 */
export function assertEmailDeliveryAllowed(env: ServerEnv): void {
  if (env.AUTH_EMAIL_DELIVERY !== "mock") {
    return;
  }

  if (process.env.VERCEL_ENV === "production") {
    throw new Error(
      "AUTH_EMAIL_DELIVERY=mock is not allowed when VERCEL_ENV=production. Use resend.",
    );
  }

  const allowMock =
    env.NODE_ENV !== "production" ||
    process.env.CI === "true" ||
    isPlaywrightLocalhostEnvironment(env);

  if (!allowMock) {
    throw new Error(
      "AUTH_EMAIL_DELIVERY=mock is not allowed in production deployments. Use resend, run under CI, or use the Playwright localhost webServer.",
    );
  }
}

type ResendLike = {
  emails: {
    send: (payload: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    }) => Promise<{ error: { message: string } | null }>;
  };
};

export type CreateResendMailerDeps = {
  createClient?: (apiKey: string) => ResendLike;
  timeoutMs?: number;
};

/**
 * Resend-backed mailer with an application-controlled timeout.
 * Never log raw verification or reset URLs, recipients in full, or API keys.
 */
export function createResendMailer(
  deps: CreateResendMailerDeps = {},
): EmailSender {
  return {
    async send(input) {
      const env = getServerEnv();
      const timeoutMs = deps.timeoutMs ?? env.EMAIL_PROVIDER_TIMEOUT_MS;
      const createClient =
        deps.createClient ?? ((apiKey: string) => new Resend(apiKey));
      const resend = createClient(env.RESEND_API_KEY);

      try {
        const result = await withEmailProviderTimeout(
          resend.emails.send({
            from: env.AUTH_EMAIL_FROM,
            to: input.to,
            subject: input.subject,
            text: input.text,
            html: input.html,
          }),
          timeoutMs,
        );
        if (result.error) {
          logEmailFailure({ code: "provider_error", to: input.to });
          throw new EmailDeliveryError(
            "provider_error",
            "Email delivery failed.",
          );
        }
      } catch (error) {
        if (error instanceof EmailDeliveryError) {
          if (error.code === "timeout") {
            logEmailFailure({ code: "timeout", to: input.to });
          }
          throw error;
        }
        logEmailFailure({ code: "provider_rejected", to: input.to });
        throw new EmailDeliveryError(
          "provider_rejected",
          "Email delivery failed.",
        );
      }
    },
  };
}

/** No-op mailer for CI, Playwright, and local runs without live credentials. */
export function createMockMailer(): EmailSender {
  return {
    async send() {
      // Intentionally empty — never log message bodies (may contain tokens).
    },
  };
}

let defaultMailer: EmailSender | undefined;

export function getMailer(): EmailSender {
  if (!defaultMailer) {
    const env = getServerEnv();
    assertEmailDeliveryAllowed(env);
    defaultMailer =
      env.AUTH_EMAIL_DELIVERY === "mock"
        ? createMockMailer()
        : createResendMailer();
  }
  return defaultMailer;
}

/** Test helper to inject a mock mailer. */
export function setMailerForTests(mailer: EmailSender | undefined): void {
  defaultMailer = mailer;
}

export function buildAppUrl(
  pathname: string,
  search?: Record<string, string>,
): string {
  const env = getServerEnv();
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const url = new URL(pathname, `${base}/`);
  if (search) {
    for (const [key, value] of Object.entries(search)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export async function sendVerificationEmail(
  mailer: EmailSender,
  input: { to: string; rawToken: string },
): Promise<void> {
  const verifyUrl = buildAppUrl("/verify-email", { token: input.rawToken });
  await mailer.send({
    to: input.to,
    subject: "Verify your Outreach account",
    text: `Open this link, then confirm verification in the browser:\n\n${verifyUrl}\n\nIf you did not create an account, you can ignore this message.`,
    html: `<p>Open this link, then confirm verification in the browser:</p><p><a href="${verifyUrl}">Continue to verify email</a></p><p>If you did not create an account, you can ignore this message.</p>`,
  });
}

export async function sendPasswordResetEmail(
  mailer: EmailSender,
  input: { to: string; rawToken: string },
): Promise<void> {
  const resetUrl = buildAppUrl("/reset-password", { token: input.rawToken });
  await mailer.send({
    to: input.to,
    subject: "Reset your Outreach password",
    text: `Reset your password by opening this link:\n\n${resetUrl}\n\nIf you did not request a reset, you can ignore this message.`,
    html: `<p>Reset your password by opening this link:</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request a reset, you can ignore this message.</p>`,
  });
}

export async function sendOrganizationInvitationEmail(
  mailer: EmailSender,
  input: {
    to: string;
    organizationName: string;
    role: string;
    expiresAt: Date;
    rawToken: string;
    inviterName: string;
  },
): Promise<void> {
  const acceptUrl = buildAppUrl("/invitations/accept", {
    token: input.rawToken,
  });
  const expiresLabel = input.expiresAt.toUTCString();
  const roleLabel = input.role.toLowerCase();
  await mailer.send({
    to: input.to,
    subject: `Invitation to join ${input.organizationName} on Outreach`,
    text: `${input.inviterName} invited you to join ${input.organizationName} as ${roleLabel}.\n\nOpen this link, then confirm acceptance in the browser:\n\n${acceptUrl}\n\nThis invitation expires on ${expiresLabel}.\n\nIf you were not expecting this invitation, you can ignore this message.`,
    html: `<p><strong>${escapeHtml(input.inviterName)}</strong> invited you to join <strong>${escapeHtml(input.organizationName)}</strong> as ${escapeHtml(roleLabel)}.</p><p>Open this link, then confirm acceptance in the browser:</p><p><a href="${acceptUrl}">Review invitation</a></p><p>This invitation expires on ${escapeHtml(expiresLabel)}.</p><p>If you were not expecting this invitation, you can ignore this message.</p>`,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
