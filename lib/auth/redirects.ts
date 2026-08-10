/**
 * Validate internal redirect destinations to prevent open redirects.
 * Only same-origin relative paths starting with a single "/" are accepted.
 */

const SAFE_FALLBACK = "/app";

const EXACT_ALLOWLIST = new Set([
  "/app",
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/app/organizations/new",
  "/invitations/accept",
]);

const PREFIX_ALLOWLIST = ["/app/orgs/"] as const;

function isAllowlistedPath(pathOnly: string): boolean {
  if (EXACT_ALLOWLIST.has(pathOnly)) {
    return true;
  }
  return PREFIX_ALLOWLIST.some(
    (prefix) => pathOnly === prefix.slice(0, -1) || pathOnly.startsWith(prefix),
  );
}

export function getSafeRedirect(
  destination: string | null | undefined,
  fallback: string = SAFE_FALLBACK,
): string {
  if (!destination) {
    return fallback;
  }

  const value = destination.trim();
  if (!value.startsWith("/")) {
    return fallback;
  }
  // Reject protocol-relative URLs (//evil.com) and backslash tricks.
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  if (value.includes("://") || value.includes("\\")) {
    return fallback;
  }
  // Reject encoded tricks that could escape the path.
  if (/%2f%2f/i.test(value) || /%5c/i.test(value)) {
    return fallback;
  }

  const pathOnly = value.split("?")[0]?.split("#")[0] ?? value;
  if (!isAllowlistedPath(pathOnly)) {
    return fallback;
  }

  // Preserve a constrained query string only for known invitation continuation.
  if (pathOnly === "/invitations/accept" || pathOnly === "/verify-email") {
    const queryIndex = value.indexOf("?");
    if (queryIndex === -1) {
      return pathOnly;
    }
    const params = new URLSearchParams(value.slice(queryIndex + 1));
    const token = params.get("token");
    if (token && /^[A-Za-z0-9_-]+$/.test(token) && token.length <= 256) {
      return `${pathOnly}?token=${encodeURIComponent(token)}`;
    }
    return pathOnly;
  }

  return pathOnly;
}

export function isSafeInternalPath(destination: string): boolean {
  return getSafeRedirect(destination, "__reject__") !== "__reject__";
}

/**
 * Build a safe post-login continuation for invitation acceptance.
 */
export function invitationAcceptPath(rawToken: string): string {
  return getSafeRedirect(
    `/invitations/accept?token=${encodeURIComponent(rawToken)}`,
    "/app",
  );
}
