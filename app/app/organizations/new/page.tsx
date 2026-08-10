import type { Metadata } from "next";
import Link from "next/link";

import { CreateOrganizationForm } from "@/components/orgs/create-organization-form";
import { requireVerifiedUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Create organization",
};

export default async function NewOrganizationPage() {
  await requireVerifiedUser({ returnTo: "/app/organizations/new" });

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-[var(--muted)]">
          <Link href="/app" className="underline-offset-2 hover:underline">
            ← Organizations
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Create organization
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          You will become the owner. Organization data stays isolated from other
          tenants.
        </p>
      </div>
      <CreateOrganizationForm />
    </div>
  );
}
