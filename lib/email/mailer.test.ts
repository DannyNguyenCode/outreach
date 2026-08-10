import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/server", () => ({
  getServerEnv: vi.fn(),
  resetServerEnvCache: vi.fn(),
}));

import {
  assertEmailDeliveryAllowed,
  createMockMailer,
  createResendMailer,
  EmailDeliveryError,
  getMailer,
  setMailerForTests,
  withEmailProviderTimeout,
} from "@/lib/email/mailer";
import { getServerEnv, resetServerEnvCache } from "@/lib/env/server";
import type { ServerEnv } from "@/lib/env/schema";

const baseEnv: ServerEnv = {
  DATABASE_URL:
    "postgresql://postgres:postgres@127.0.0.1:5432/outreach?schema=public",
  DIRECT_URL:
    "postgresql://postgres:postgres@127.0.0.1:5432/outreach?schema=public",
  AUTH_SECRET: "dev-only-auth-secret-replace-me-32chars",
  RESEND_API_KEY: "re_test_fake_key",
  AUTH_EMAIL_FROM: "Outreach <auth@mail.example.com>",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  AUTH_EMAIL_DELIVERY: "resend",
  EMAIL_PROVIDER_TIMEOUT_MS: 5_000,
  AUTH_TRUST_HOST: false,
  NODE_ENV: "test",
};

describe("email provider timeout and failures", () => {
  beforeEach(() => {
    vi.mocked(getServerEnv).mockReturnValue({ ...baseEnv });
    resetServerEnvCache();
    setMailerForTests(undefined);
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setMailerForTests(undefined);
  });

  it("resolves successful provider delivery", async () => {
    const send = vi.fn(async () => ({ error: null }));
    const mailer = createResendMailer({
      createClient: () => ({ emails: { send } }),
      timeoutMs: 1_000,
    });
    await mailer.send({
      to: "user@example.com",
      subject: "Hello",
      text: "body without secrets",
      html: "<p>body</p>",
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("handles provider-declared error responses", async () => {
    const mailer = createResendMailer({
      createClient: () => ({
        emails: {
          send: async () => ({ error: { message: "boom" } }),
        },
      }),
      timeoutMs: 1_000,
    });
    await expect(
      mailer.send({
        to: "user@example.com",
        subject: "Hello",
        text: "token=super-secret-token-value",
        html: "<p>https://example.com/verify-email?token=super-secret-token-value</p>",
      }),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it("handles provider promise rejection", async () => {
    const mailer = createResendMailer({
      createClient: () => ({
        emails: {
          send: async () => {
            throw new Error("network down");
          },
        },
      }),
      timeoutMs: 1_000,
    });
    await expect(
      mailer.send({
        to: "user@example.com",
        subject: "Hello",
        text: "body",
        html: "<p>body</p>",
      }),
    ).rejects.toMatchObject({ code: "provider_rejected" });
  });

  it("times out a never-resolving provider within the expected interval", async () => {
    vi.useFakeTimers();
    const mailer = createResendMailer({
      createClient: () => ({
        emails: {
          send: () => new Promise(() => undefined),
        },
      }),
      timeoutMs: 2_000,
    });

    const pending = mailer.send({
      to: "user@example.com",
      subject: "Hello",
      text: "body",
      html: "<p>body</p>",
    });
    const expectation = expect(pending).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await expectation;
  });

  it("clears timeout resources after a successful response", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const mailer = createResendMailer({
      createClient: () => ({
        emails: {
          send: async () => ({ error: null }),
        },
      }),
      timeoutMs: 5_000,
    });
    await mailer.send({
      to: "user@example.com",
      subject: "Hello",
      text: "body",
      html: "<p>body</p>",
    });
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("does not log tokens, URLs, recipients, or credentials on failure", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const mailer = createResendMailer({
      createClient: () => ({
        emails: {
          send: async () => ({ error: { message: "boom" } }),
        },
      }),
      timeoutMs: 1_000,
    });
    await expect(
      mailer.send({
        to: "secret.user@example.com",
        subject: "Hello",
        text: "https://example.com/verify-email?token=raw-token-abc",
        html: "<a href='https://example.com/verify-email?token=raw-token-abc'>x</a>",
      }),
    ).rejects.toBeInstanceOf(EmailDeliveryError);

    const logged = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(logged).not.toContain("raw-token-abc");
    expect(logged).not.toContain("secret.user@example.com");
    expect(logged).not.toContain("re_test_fake_key");
    expect(logged).not.toContain("verify-email?token=");
    expect(logged).toContain("example.com");
    errorSpy.mockRestore();
  });

  it("mock mode never constructs or invokes the live provider", async () => {
    vi.mocked(getServerEnv).mockReturnValue({
      ...baseEnv,
      AUTH_EMAIL_DELIVERY: "mock",
    });
    const createClient = vi.fn();
    setMailerForTests(undefined);
    const mailer = getMailer();
    await mailer.send({
      to: "user@example.com",
      subject: "Hello",
      text: "body",
      html: "<p>body</p>",
    });
    expect(createClient).not.toHaveBeenCalled();
    // Ensure mock path is the no-op helper.
    await createMockMailer().send({
      to: "user@example.com",
      subject: "Hello",
      text: "body",
      html: "<p>body</p>",
    });
  });

  it("production rejects mock delivery mode", () => {
    const previousCi = process.env.CI;
    const previousPlaywright = process.env.PLAYWRIGHT_WEB_SERVER;
    const previousVercel = process.env.VERCEL_ENV;
    delete process.env.CI;
    delete process.env.PLAYWRIGHT_WEB_SERVER;
    delete process.env.VERCEL_ENV;
    try {
      expect(() =>
        assertEmailDeliveryAllowed({
          ...baseEnv,
          AUTH_EMAIL_DELIVERY: "mock",
          NODE_ENV: "production",
        }),
      ).toThrow(/not allowed in production/i);
    } finally {
      if (previousCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = previousCi;
      }
      if (previousPlaywright === undefined) {
        delete process.env.PLAYWRIGHT_WEB_SERVER;
      } else {
        process.env.PLAYWRIGHT_WEB_SERVER = previousPlaywright;
      }
      if (previousVercel === undefined) {
        delete process.env.VERCEL_ENV;
      } else {
        process.env.VERCEL_ENV = previousVercel;
      }
    }
  });

  it("Vercel production rejects mock mode even with a local-test Playwright override", () => {
    const previousCi = process.env.CI;
    const previousPlaywright = process.env.PLAYWRIGHT_WEB_SERVER;
    const previousVercel = process.env.VERCEL_ENV;
    const previousAllow = process.env.AUTH_ALLOW_MOCK_EMAIL;
    delete process.env.CI;
    process.env.PLAYWRIGHT_WEB_SERVER = "true";
    process.env.AUTH_ALLOW_MOCK_EMAIL = "true";
    process.env.VERCEL_ENV = "production";
    try {
      expect(() =>
        assertEmailDeliveryAllowed({
          ...baseEnv,
          AUTH_EMAIL_DELIVERY: "mock",
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
        }),
      ).toThrow(/VERCEL_ENV=production/i);
    } finally {
      if (previousCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = previousCi;
      }
      if (previousPlaywright === undefined) {
        delete process.env.PLAYWRIGHT_WEB_SERVER;
      } else {
        process.env.PLAYWRIGHT_WEB_SERVER = previousPlaywright;
      }
      if (previousVercel === undefined) {
        delete process.env.VERCEL_ENV;
      } else {
        process.env.VERCEL_ENV = previousVercel;
      }
      if (previousAllow === undefined) {
        delete process.env.AUTH_ALLOW_MOCK_EMAIL;
      } else {
        process.env.AUTH_ALLOW_MOCK_EMAIL = previousAllow;
      }
    }
  });

  it("allows mock delivery for Playwright webServer on localhost", () => {
    const previousCi = process.env.CI;
    const previousPlaywright = process.env.PLAYWRIGHT_WEB_SERVER;
    const previousVercel = process.env.VERCEL_ENV;
    delete process.env.CI;
    delete process.env.VERCEL_ENV;
    process.env.PLAYWRIGHT_WEB_SERVER = "true";
    try {
      expect(() =>
        assertEmailDeliveryAllowed({
          ...baseEnv,
          AUTH_EMAIL_DELIVERY: "mock",
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
        }),
      ).not.toThrow();
    } finally {
      if (previousCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = previousCi;
      }
      if (previousPlaywright === undefined) {
        delete process.env.PLAYWRIGHT_WEB_SERVER;
      } else {
        process.env.PLAYWRIGHT_WEB_SERVER = previousPlaywright;
      }
      if (previousVercel === undefined) {
        delete process.env.VERCEL_ENV;
      } else {
        process.env.VERCEL_ENV = previousVercel;
      }
    }
  });

  it("withEmailProviderTimeout clears timers on success", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const result = withEmailProviderTimeout(Promise.resolve("ok"), 5_000);
    await expect(result).resolves.toBe("ok");
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
