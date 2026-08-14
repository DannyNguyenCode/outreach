import {
  ConfigNotStarted,
  ConfigPageHeader,
  loadConfigPageContext,
} from "@/components/orgs/config/config-page";
import { MarkSectionCompleteForm } from "@/components/orgs/config/form-helpers";
import { ServiceAreasManager } from "@/components/orgs/config/service-areas-manager";
import { listServiceAreas } from "@/lib/orgs/service-areas";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function ServiceAreasSettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const ctx = await loadConfigPageContext(slug, "/service-areas");
  const currentPath = `/app/orgs/${slug}/settings/service-areas`;

  if (ctx.progressNotStarted) {
    return (
      <div className="space-y-8">
        <ConfigPageHeader
          ctx={ctx}
          title="Service areas"
          description="Define where you serve customers. Areas are soft-deactivated, never hard-deleted."
          currentPath={currentPath}
        />
        <ConfigNotStarted ctx={ctx} />
      </div>
    );
  }

  const areasResult = await listServiceAreas({
    actor: ctx.user,
    organizationId: ctx.membership.organizationId,
  });

  return (
    <div className="space-y-8">
      <ConfigPageHeader
        ctx={ctx}
        title="Service areas"
        description="Define where you serve customers. Areas are soft-deactivated, never hard-deleted."
        currentPath={currentPath}
      />

      <ServiceAreasManager
        organizationSlug={slug}
        canManage={ctx.canManageConfig}
        areas={
          areasResult.ok
            ? areasResult.areas.map((area) => ({
                id: area.id,
                label: area.label,
                countryCode: area.countryCode,
                region: area.region,
                city: area.city,
                postalPrefix: area.postalPrefix,
                isRemote: area.isRemote,
                isActive: area.isActive,
                version: area.version,
                displayOrder: area.displayOrder,
              }))
            : []
        }
      />

      {ctx.canManageConfig && ctx.progress ? (
        <MarkSectionCompleteForm
          organizationSlug={slug}
          expectedVersion={ctx.progress.version}
          section="SERVICE_AREAS"
          nextSection="AVAILABILITY"
          label="Mark service areas complete"
        />
      ) : null}
    </div>
  );
}
