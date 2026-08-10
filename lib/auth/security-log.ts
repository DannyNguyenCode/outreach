import "server-only";

/**
 * Minimal structured security-event logging.
 * Never log passwords, hashes, raw tokens, full emails, session cookies, or auth headers.
 */

export type SecurityEventName =
  | "auth.register_requested"
  | "auth.register_completed"
  | "auth.login_succeeded"
  | "auth.login_failed"
  | "auth.login_unverified"
  | "auth.verification_completed"
  | "auth.verification_resend_requested"
  | "auth.password_reset_requested"
  | "auth.password_reset_completed"
  | "auth.logout"
  | "auth.session_revoked"
  | "auth.rate_limited";

export type SecurityEventPayload = {
  event: SecurityEventName;
  /** Truncated / hashed identifiers only. */
  userIdPrefix?: string;
  emailDomain?: string;
  route?: string;
  reason?: string;
};

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) {
    return "unknown";
  }
  return email.slice(at + 1).toLowerCase();
}

export function userIdPrefix(userId: string): string {
  return userId.slice(0, 8);
}

export function logSecurityEvent(payload: SecurityEventPayload): void {
  const line = {
    ts: new Date().toISOString(),
    ...payload,
  };
  console.info(JSON.stringify(line));
}
