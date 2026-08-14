import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfigNav } from "@/components/orgs/config/config-nav";
import { StartConfigForm } from "@/components/orgs/config/start-config-form";
import { requireVerifiedUser } from "@/lib/auth/session";
import type { SafeUser } from "@/lib/auth/users";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import {
  getConfigProgress,
  type ConfigProgressView,
} from "@/lib/orgs/config-progress";
import { roleHasPermission } from "@/lib/orgs/permissions";
import type { OrganizationRole } from "@prisma/client";

export type ConfigPageContext = {
  slug: string;
  user: SafeUser;
  membership: {
    organizationId: string;
    role: OrganizationRole;
    organization: { name: string };
  };
  canManageConfig: boolean;
  canManageTemplates: boolean;
  progress: ConfigProgressView | null;
  progressNotStarted: boolean;
};

export async function loadConfigPageContext(
  slug: string,
  pathSuffix = "",
): Promise<ConfigPageContext> {
  const returnTo = `/app/orgs/${slug}/settings${pathSuffix}`;
  const user = await requireVerifiedUser({ returnTo });

  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      notFound();
    }
    throw error;
  }

  await setActiveOrganization({
    user,
    organizationId: membership.organizationId,
  });

  const canManageConfig = roleHasPermission(
    membership.role,
    "org.config.manage",
  );
  const canManageTemplates = roleHasPermission(
    membership.role,
    "org.templates.manage",
  );

  const progressResult = await getConfigProgress({
    actor: user,
    organizationId: membership.organizationId,
  });

  return {
    slug,
    user,
    membership: {
      organizationId: membership.organizationId,
      role: membership.role,
      organization: { name: membership.organization.name },
    },
    canManageConfig,
    canManageTemplates,
    progress: progressResult.ok ? progressResult.progress : null,
    progressNotStarted:
      !progressResult.ok && progressResult.reason === "not_started",
  };
}

export function ConfigPageHeader({
  ctx,
  title,
  description,
  currentPath,
}: {
  ctx: ConfigPageContext;
  title: string;
  description: string;
  currentPath: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-[var(--muted)]">
          <Link
            href={`/app/orgs/${ctx.slug}/settings`}
            className="underline-offset-2 hover:underline"
          >
            ← Organization settings
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-[var(--muted)]">{description}</p>
      </div>
      <ConfigNav
        organizationSlug={ctx.slug}
        currentPath={currentPath}
        completedSections={ctx.progress?.completedSections ?? []}
        currentSection={ctx.progress?.currentSection ?? null}
      />
      {ctx.progress?.status === "COMPLETED" ? (
        <p className="text-sm font-medium" role="status">
          Extended configuration is complete.
        </p>
      ) : ctx.progress ? (
        <p className="text-sm text-[var(--muted)]">
          Resume at{" "}
          {ctx.progress.currentSection.toLowerCase().replaceAll("_", " ")}.
        </p>
      ) : null}
    </div>
  );
}

export function ConfigNotStarted({ ctx }: { ctx: ConfigPageContext }) {
  if (ctx.canManageConfig) {
    return <StartConfigForm organizationSlug={ctx.slug} />;
  }
  return (
    <p className="text-sm text-[var(--muted)]">
      Extended configuration has not been started for{" "}
      {ctx.membership.organization.name}.
    </p>
  );
}
