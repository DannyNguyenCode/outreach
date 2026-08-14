import {
  ConfigNotStarted,
  ConfigPageHeader,
  loadConfigPageContext,
} from "@/components/orgs/config/config-page";
import { MarkSectionCompleteForm } from "@/components/orgs/config/form-helpers";
import { HolidayClosuresManager } from "@/components/orgs/config/holiday-closures-manager";
import { listHolidayClosures } from "@/lib/orgs/holiday-closures";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function AvailabilitySettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const ctx = await loadConfigPageContext(slug, "/availability");
  const currentPath = `/app/orgs/${slug}/settings/availability`;

  if (ctx.progressNotStarted) {
    return (
      <div className="space-y-8">
        <ConfigPageHeader
          ctx={ctx}
          title="Availability"
          description="Manage holiday closures. Weekly operating hours remain on the main settings page."
          currentPath={currentPath}
        />
        <ConfigNotStarted ctx={ctx} />
      </div>
    );
  }

  const closuresResult = await listHolidayClosures({
    actor: ctx.user,
    organizationId: ctx.membership.organizationId,
  });

  return (
    <div className="space-y-8">
      <ConfigPageHeader
        ctx={ctx}
        title="Availability"
        description="Manage holiday closures. Weekly operating hours remain on the main settings page."
        currentPath={currentPath}
      />

      <HolidayClosuresManager
        organizationSlug={slug}
        canManage={ctx.canManageConfig}
        organizationTimeZone={
          closuresResult.ok ? closuresResult.organizationTimeZone : null
        }
        closures={
          closuresResult.ok
            ? closuresResult.closures.map((closure) => ({
                id: closure.id,
                localDateStart: closure.localDateStart,
                localDateEnd: closure.localDateEnd,
                isClosedAllDay: closure.isClosedAllDay,
                replacementIntervals: closure.replacementIntervals,
                customerNote: closure.customerNote,
                internalLabel: closure.internalLabel,
                isActive: closure.isActive,
                version: closure.version,
              }))
            : []
        }
      />

      {ctx.canManageConfig && ctx.progress ? (
        <MarkSectionCompleteForm
          organizationSlug={slug}
          expectedVersion={ctx.progress.version}
          section="AVAILABILITY"
          nextSection="LEAD_STAGES"
          label="Mark availability complete"
        />
      ) : null}
    </div>
  );
}
