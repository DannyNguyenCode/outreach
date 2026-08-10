import { z } from "zod";

const nonemptyUrl = z.string().url().min(1);

const authSecretSchema = z
  .string()
  .min(32, "AUTH_SECRET must be at least 32 characters.");

const emailFromSchema = z
  .string()
  .min(3)
  .refine((value) => {
    // Accept "Name <email@domain>" or bare email.
    const match = value.match(/^(?:.*<\s*)?([^\s<>]+@[^\s<>]+)\s*>?$/);
    return Boolean(
      match?.[1] && z.string().email().safeParse(match[1]).success,
    );
  }, "AUTH_EMAIL_FROM must include a valid email address.");

/**
 * Server-only environment variables.
 * Never import this schema into Client Components.
 */
export const serverEnvSchema = z.object({
  DATABASE_URL: nonemptyUrl,
  DIRECT_URL: nonemptyUrl,
  AUTH_SECRET: authSecretSchema,
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required."),
  AUTH_EMAIL_FROM: emailFromSchema,
  /** Canonical public origin used to build verification/reset links. */
  NEXT_PUBLIC_APP_URL: nonemptyUrl,
  AUTH_EMAIL_DELIVERY: z.enum(["resend", "mock"]).default("resend"),
  AUTH_TRUST_HOST: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
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
