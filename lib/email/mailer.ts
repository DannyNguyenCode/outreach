import "server-only";

import { Resend } from "resend";

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

/**
 * Resend-backed mailer. Tests should inject a mock EmailSender instead.
 * Never log raw verification or reset URLs.
 */
export function createResendMailer(): EmailSender {
  return {
    async send(input) {
      const env = getServerEnv();
      const resend = new Resend(env.RESEND_API_KEY);
      const result = await resend.emails.send({
        from: env.AUTH_EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      if (result.error) {
        throw new Error(`Email delivery failed: ${result.error.message}`);
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
    text: `Verify your email by opening this link:\n\n${verifyUrl}\n\nIf you did not create an account, you can ignore this message.`,
    html: `<p>Verify your email by opening this link:</p><p><a href="${verifyUrl}">Verify email</a></p><p>If you did not create an account, you can ignore this message.</p>`,
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
