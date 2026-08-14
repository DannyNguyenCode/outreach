"use client";

import Link from "next/link";

import type { ConfigSectionValue } from "@/lib/orgs/config-3b-validation";

type ConfigNavItem = {
  href: string;
  label: string;
  section?: ConfigSectionValue | ConfigSectionValue[];
};

const ITEMS: ConfigNavItem[] = [
  { href: "", label: "Overview" },
  {
    href: "/business-template",
    label: "Business template",
    section: "BUSINESS_TEMPLATE",
  },
  { href: "/service-areas", label: "Service areas", section: "SERVICE_AREAS" },
  { href: "/availability", label: "Availability", section: "AVAILABILITY" },
  {
    href: "/operational-defaults",
    label: "Operational defaults",
    section: [
      "LOCALE",
      "LEAD_STAGES",
      "CALL_DISPOSITIONS",
      "CALLBACK_POLICY",
      "RECORDING_CONSENT",
      "NOTIFICATIONS",
      "CUSTOM_FIELDS",
    ],
  },
];

export function ConfigNav({
  organizationSlug,
  currentPath,
  completedSections = [],
  currentSection,
}: {
  organizationSlug: string;
  currentPath: string;
  completedSections?: ConfigSectionValue[];
  currentSection?: ConfigSectionValue | null;
}) {
  const base = `/app/orgs/${organizationSlug}/settings`;
  const completed = new Set(completedSections);

  return (
    <nav aria-label="Configuration sections" className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        Configuration
      </p>
      <ul className="flex flex-wrap gap-2">
        {ITEMS.map((item) => {
          const href = `${base}${item.href}`;
          const isActive =
            item.href === ""
              ? currentPath === base || currentPath === `${base}/`
              : currentPath.startsWith(href);
          const sections = item.section
            ? Array.isArray(item.section)
              ? item.section
              : [item.section]
            : [];
          const isComplete =
            sections.length > 0 &&
            sections.every((section) => completed.has(section));
          const isCurrent = currentSection && sections.includes(currentSection);

          return (
            <li key={href}>
              <Link
                href={href}
                className={[
                  "inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm",
                  isActive
                    ? "border-[var(--foreground)] bg-[var(--surface)] font-medium"
                    : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]",
                ].join(" ")}
                aria-current={isActive ? "page" : undefined}
              >
                {item.label}
                {isComplete ? (
                  <span
                    className="text-xs text-[var(--muted)]"
                    aria-label="completed"
                  >
                    ✓
                  </span>
                ) : null}
                {isCurrent && !isComplete ? (
                  <span className="text-xs text-[var(--muted)]">(current)</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
