import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/auth";
import { getSafeRedirect } from "@/lib/auth/redirects";

/**
 * Next.js 16 Proxy (formerly middleware).
 * Provides early redirects only — server components/actions still enforce auth.
 */
export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  const session = await auth();
  const hasValidSession = Boolean(
    session?.user?.id && (session.user.sessionVersion ?? -1) >= 0,
  );

  const isAuthPage =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password";

  if (pathname.startsWith("/app")) {
    if (!hasValidSession) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set(
        "callbackUrl",
        getSafeRedirect(pathname, "/app"),
      );
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  if (isAuthPage && hasValidSession) {
    const callback = getSafeRedirect(searchParams.get("callbackUrl"), "/app");
    return NextResponse.redirect(new URL(callback, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/app/:path*",
    "/login",
    "/register",
    "/forgot-password",
    "/invitations/accept",
  ],
};
