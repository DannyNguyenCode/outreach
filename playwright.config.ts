import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

const testDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/outreach_test?schema=public";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: process.env.CI
      ? `npm run start -- --port ${port}`
      : `npm run build && npm run start -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: process.env.DIRECT_URL ?? testDatabaseUrl,
      AUTH_SECRET:
        process.env.AUTH_SECRET ?? "dev-only-auth-secret-replace-me-32chars",
      RESEND_API_KEY: process.env.RESEND_API_KEY ?? "re_test_fake_key",
      AUTH_EMAIL_FROM:
        process.env.AUTH_EMAIL_FROM ?? "Outreach <auth@mail.example.com>",
      AUTH_EMAIL_DELIVERY: process.env.AUTH_EMAIL_DELIVERY ?? "mock",
      EMAIL_PROVIDER_TIMEOUT_MS:
        process.env.EMAIL_PROVIDER_TIMEOUT_MS ?? "10000",
      AUTH_ALLOW_MOCK_EMAIL: process.env.AUTH_ALLOW_MOCK_EMAIL ?? "true",
      NEXT_PUBLIC_APP_URL: baseURL,
      AUTH_TRUST_HOST: "true",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
