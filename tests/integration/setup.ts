import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.test", quiet: true });

if (!process.env.NODE_ENV) {
  Object.assign(process.env, { NODE_ENV: "test" });
}
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5433/outreach_test?schema=public";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.AUTH_SECRET ??= "dev-only-auth-secret-replace-me-32chars";
process.env.RESEND_API_KEY ??= "re_test_fake_key";
process.env.AUTH_EMAIL_FROM ??= "Outreach <auth@mail.example.com>";
process.env.AUTH_EMAIL_DELIVERY ??= "mock";
process.env.NEXT_PUBLIC_APP_URL ??= "http://127.0.0.1:3100";
