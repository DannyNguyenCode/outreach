import Link from "next/link";

import type { OnboardingStepValue } from "@/lib/orgs/business-validation";
import { ONBOARDING_STEPS } from "@/lib/orgs/business-validation";

const STEP_META: Record<OnboardingStepValue, { href: string; label: string }> =
  {
    BUSINESS_BASICS: { href: "basics", label: "Business basics" },
    CONTACT_LOCATION: { href: "contact", label: "Contact & location" },
    OPERATING_HOURS: { href: "hours", label: "Operating hours" },
    CATALOGUE: { href: "catalogue", label: "Services & products" },
    EMPLOYEE_DEFAULTS: { href: "defaults", label: "Employee defaults" },
    REVIEW: { href: "review", label: "Review" },
  };

export function OnboardingProgress({
  slug,
  currentStep,
  completedSteps,
  status,
}: {
  slug: string;
  currentStep: OnboardingStepValue;
  completedSteps: OnboardingStepValue[];
  status: string;
}) {
  return (
    <nav aria-label="Onboarding progress" className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        Status:{" "}
        <span className="font-medium text-[var(--foreground)]">
          {status.toLowerCase().replaceAll("_", " ")}
        </span>
      </p>
      <ol className="flex flex-wrap gap-2">
        {ONBOARDING_STEPS.map((step, index) => {
          const meta = STEP_META[step];
          const done = completedSteps.includes(step);
          const current = currentStep === step;
          return (
            <li key={step}>
              <Link
                href={`/app/orgs/${slug}/onboarding/${meta.href}`}
                aria-current={current ? "step" : undefined}
                className={`inline-flex items-center gap-2 rounded-sm border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] ${
                  current
                    ? "border-[var(--foreground)] bg-[var(--surface)]"
                    : "border-[var(--border)] bg-[var(--background)] hover:bg-[var(--surface)]"
                }`}
              >
                <span className="text-[var(--muted)]">{index + 1}.</span>
                <span>{meta.label}</span>
                {done ? (
                  <span className="text-xs text-[var(--muted)]">saved</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function stepPathToEnum(step: string): OnboardingStepValue | null {
  switch (step) {
    case "basics":
      return "BUSINESS_BASICS";
    case "contact":
      return "CONTACT_LOCATION";
    case "hours":
      return "OPERATING_HOURS";
    case "catalogue":
      return "CATALOGUE";
    case "defaults":
      return "EMPLOYEE_DEFAULTS";
    case "review":
      return "REVIEW";
    default:
      return null;
  }
}

export function enumToStepPath(step: OnboardingStepValue): string {
  return STEP_META[step].href;
}
