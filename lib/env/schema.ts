import { z } from "zod";

const nonemptyUrl = z.string().url().min(1);

/**
 * Server-only environment variables.
 * Never import this schema into Client Components.
 */
export const serverEnvSchema = z.object({
  DATABASE_URL: nonemptyUrl,
  DIRECT_URL: nonemptyUrl,
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

/**
 * Variables safe to expose to the browser (NEXT_PUBLIC_*).
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: nonemptyUrl,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function formatEnvErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
