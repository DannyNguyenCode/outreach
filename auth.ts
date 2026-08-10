import "server-only";

import { CredentialsSignin } from "@auth/core/errors";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";

import {
  getSessionVersion,
  verifyCredentials,
} from "@/lib/auth/account-service";
import {
  emailDomain,
  logSecurityEvent,
  userIdPrefix,
} from "@/lib/auth/security-log";
import { loginSchema } from "@/lib/auth/validation";

class EmailNotVerifiedError extends CredentialsSignin {
  code = "email_not_verified";
}

type AppJWT = JWT & {
  id?: string;
  email?: string;
  name?: string;
  sessionVersion?: number;
};

/**
 * Auth.js (next-auth@5.0.0-beta.32) configuration.
 *
 * Session strategy: JWT
 * Why: The Credentials provider does not create database sessions in Auth.js v5.
 * Database session strategy is incompatible with Credentials sign-in.
 *
 * Revocation: Each JWT embeds `sessionVersion`. Protected server helpers compare
 * that value to `User.sessionVersion`. Password reset increments the version so
 * existing JWTs fail authorization even though the cookie still decrypts.
 * Logout clears the browser session cookie via Auth.js signOut.
 *
 * Do not treat a JWT as revoked merely because a DB field changed unless the
 * protected path actually re-checks sessionVersion (see requireVerifiedUser).
 */

declare module "next-auth" {
  interface User {
    id: string;
    email: string;
    name: string;
    sessionVersion: number;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      sessionVersion: number;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60, // refresh cookie at most hourly
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          logSecurityEvent({
            event: "auth.login_failed",
            reason: "validation",
            route: "login",
          });
          return null;
        }

        const result = await verifyCredentials(parsed.data);

        if (result.status === "unverified") {
          logSecurityEvent({
            event: "auth.login_unverified",
            userIdPrefix: userIdPrefix(result.userId),
            emailDomain: emailDomain(parsed.data.email),
          });
          throw new EmailNotVerifiedError();
        }

        if (result.status !== "ok") {
          logSecurityEvent({
            event: "auth.login_failed",
            emailDomain: emailDomain(parsed.data.email),
            reason: "invalid_credentials",
          });
          return null;
        }

        logSecurityEvent({
          event: "auth.login_succeeded",
          userIdPrefix: userIdPrefix(result.user.id),
          emailDomain: emailDomain(result.user.email),
        });

        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          sessionVersion: result.user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const appToken = token as AppJWT;

      if (user) {
        appToken.id = user.id;
        appToken.email = user.email;
        appToken.name = user.name;
        appToken.sessionVersion = user.sessionVersion;
        return appToken;
      }

      // Re-check revocation version periodically when token is used.
      if (appToken.id && typeof appToken.sessionVersion === "number") {
        const current = await getSessionVersion(appToken.id);
        if (current === null || current !== appToken.sessionVersion) {
          // Mark token invalid by clearing identity; auth() will lack user id.
          delete appToken.id;
          delete appToken.email;
          delete appToken.name;
          delete appToken.sessionVersion;
        }
      }

      return appToken;
    },
    async session({ session, token }) {
      const appToken = token as AppJWT;

      if (!appToken.id || typeof appToken.sessionVersion !== "number") {
        return {
          ...session,
          user: {
            id: "",
            email: "",
            name: "",
            sessionVersion: -1,
          },
        };
      }

      session.user = {
        id: appToken.id,
        email: appToken.email ?? "",
        name: appToken.name ?? "",
        sessionVersion: appToken.sessionVersion,
        emailVerified: null,
      } as typeof session.user;
      return session;
    },
  },
});
