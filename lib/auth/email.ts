import { z } from "zod";

/**
 * Normalize emails for storage and lookup: trim + lowercase.
 * Case-insensitive uniqueness is enforced by storing only normalized values.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .max(254, "Email is too long.")
  .email("Enter a valid email address.")
  .transform((value) => normalizeEmail(value));

export function parseEmail(input: unknown): string | null {
  const result = emailSchema.safeParse(input);
  return result.success ? result.data : null;
}
