import Link from "next/link";

import { OnboardingProgress } from "@/components/orgs/onboarding/onboarding-progress";
import type { OnboardingStepValue } from "@/lib/orgs/business-validation";

export function OnboardingShell({
  slug,
  orgName,
  children,
  onboarding,
}: {
  slug: string;
  orgName: string;
  children: React.ReactNode;
  onboarding: {
    status: string;
    currentStep: OnboardingStepValue;
    completedSteps: OnboardingStepValue[];
  };
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-[var(--muted)]">
          <Link
            href={`/app/orgs/${slug}`}
            className="underline-offset-2 hover:underline"
          >
            ← {orgName}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Business onboarding
        </h1>
      </div>
      <OnboardingProgress
        slug={slug}
        currentStep={onboarding.currentStep}
        completedSteps={onboarding.completedSteps}
        status={onboarding.status}
      />
      {children}
    </div>
  );
}
