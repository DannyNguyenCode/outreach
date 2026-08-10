import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { getSafeRedirect } from "@/lib/auth/redirects";

export const metadata: Metadata = {
  title: "Sign in",
};

type LoginPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackUrl = getSafeRedirect(params.callbackUrl, "/app");

  return <LoginForm callbackUrl={callbackUrl} />;
}
