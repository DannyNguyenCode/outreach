import {
  clientEnvSchema,
  formatEnvErrors,
  type ClientEnv,
} from "@/lib/env/schema";

let cached: ClientEnv | undefined;

/**
 * Validates and returns browser-safe (NEXT_PUBLIC_*) environment variables.
 */
export function getClientEnv(): ClientEnv {
  if (cached) {
    return cached;
  }

  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid client environment: ${formatEnvErrors(parsed.error)}`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test helper — clears the cached validated env. */
export function resetClientEnvCache(): void {
  cached = undefined;
}
