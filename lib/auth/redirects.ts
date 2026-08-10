/**
 * Validate internal redirect destinations to prevent open redirects.
 * Only same-origin relative paths starting with a single "/" are accepted.
 */

const SAFE_FALLBACK = "/app";

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
  // Allow only a constrained set of internal destinations for Phase 1.
  const allowlist = ["/app", "/login", "/register", "/verify-email"];
  const pathOnly = value.split("?")[0]?.split("#")[0] ?? value;
  if (!allowlist.includes(pathOnly)) {
    return fallback;
  }

  return pathOnly;
}

export function isSafeInternalPath(destination: string): boolean {
  return getSafeRedirect(destination, "__reject__") !== "__reject__";
}
