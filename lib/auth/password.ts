import "server-only";

import { hash, verify } from "@node-rs/argon2";

/**
 * Password policy and Argon2id hashing (server-only).
 *
 * Argon2id parameters (OWASP-aligned for interactive logins):
 * - memoryCost: 19456 KiB (~19 MiB) — balances security vs serverless latency
 * - timeCost: 2 — recommended minimum iterations for Argon2id
 * - parallelism: 1 — single lane; suitable for constrained Node workers
 * - outputLen: 32 — 256-bit tag
 * - algorithm: 2 (Argon2id) — hybrid resistant to side-channel and GPU attacks
 *
 * These values follow OWASP Password Storage Cheat Sheet guidance for Argon2id
 * at interactive login cost without requiring dedicated worker hardware.
 */

export const PASSWORD_MIN_LENGTH = 12;
/** Upper bound to reject abusive payloads without silently truncating. */
export const PASSWORD_MAX_LENGTH = 128;

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  algorithm: 2 as const, // Argon2id
};

export type PasswordPolicyIssue =
  "empty" | "whitespace_only" | "too_short" | "too_long";

export function validatePasswordPolicy(
  password: string,
): PasswordPolicyIssue | null {
  if (password.length === 0) {
    return "empty";
  }
  if (password.trim().length === 0) {
    return "whitespace_only";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return "too_short";
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return "too_long";
  }
  return null;
}

export function passwordPolicyMessage(issue: PasswordPolicyIssue): string {
  switch (issue) {
    case "empty":
      return "Password is required.";
    case "whitespace_only":
      return "Password cannot be only whitespace.";
    case "too_short":
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    case "too_long":
      return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const issue = validatePasswordPolicy(password);
  if (issue) {
    throw new Error(`Invalid password: ${issue}`);
  }
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!passwordHash || password.length === 0) {
    return false;
  }
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
