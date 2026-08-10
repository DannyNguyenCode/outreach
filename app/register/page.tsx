import type { Metadata } from "next";

import { RegisterForm } from "@/components/auth/register-form";
import { getSafeRedirect } from "@/lib/auth/redirects";

export const metadata: Metadata = {
  title: "Register",
};

type RegisterPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function RegisterPage({
  searchParams,
}: RegisterPageProps) {
  const params = await searchParams;
  const callbackUrl = getSafeRedirect(params.callbackUrl, "/app");

  return <RegisterForm callbackUrl={callbackUrl} />;
}
