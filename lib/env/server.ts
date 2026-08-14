import "server-only";

import {
  formatEnvErrors,
  serverEnvSchema,
  type ServerEnv,
} from "@/lib/env/schema";

let cached: ServerEnv | undefined;

/**
 * Validates and returns server-only environment variables.
 * Throws a clear error when required values are missing or invalid.
 */
export function getServerEnv(): ServerEnv {
  if (cached) {
    return cached;
  }

  const parsed = serverEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    AUTH_EMAIL_DELIVERY: process.env.AUTH_EMAIL_DELIVERY,
    EMAIL_PROVIDER_TIMEOUT_MS: process.env.EMAIL_PROVIDER_TIMEOUT_MS,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    KNOWLEDGE_STORAGE_BUCKET: process.env.KNOWLEDGE_STORAGE_BUCKET,
    MALWARE_SCANNER_URL: process.env.MALWARE_SCANNER_URL,
    MALWARE_SCANNER_API_KEY: process.env.MALWARE_SCANNER_API_KEY,
    MALWARE_SCANNER_NAME: process.env.MALWARE_SCANNER_NAME,
    MALWARE_SCANNER_VERSION: process.env.MALWARE_SCANNER_VERSION,
    KNOWLEDGE_WORKER_TOKEN: process.env.KNOWLEDGE_WORKER_TOKEN,
    KNOWLEDGE_DOCUMENT_ADAPTER_MODE:
      process.env.KNOWLEDGE_DOCUMENT_ADAPTER_MODE,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid server environment: ${formatEnvErrors(parsed.error)}`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test helper — clears the cached validated env. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
