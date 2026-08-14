import {
  ConfigNotStarted,
  ConfigPageHeader,
  loadConfigPageContext,
} from "@/components/orgs/config/config-page";
import { CallbackPolicyForm } from "@/components/orgs/config/callback-policy-form";
import { CustomFieldsManager } from "@/components/orgs/config/custom-fields-manager";
import { DispositionsForm } from "@/components/orgs/config/dispositions-form";
import { MarkSectionCompleteForm } from "@/components/orgs/config/form-helpers";
import { LeadStagesForm } from "@/components/orgs/config/lead-stages-form";
import { LocaleForm } from "@/components/orgs/config/locale-form";
import { NotificationDefaultsForm } from "@/components/orgs/config/notification-defaults-form";
import { RecordingConsentForm } from "@/components/orgs/config/recording-consent-form";
import { listCustomFields } from "@/lib/orgs/custom-fields";
import { getLocaleSettings } from "@/lib/orgs/locale-settings";
import {
  getCallbackPolicy,
  getNotificationDefaults,
  getRecordingConsentPolicy,
  listCallDispositions,
  listLeadStages,
} from "@/lib/orgs/operational-defaults";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function OperationalDefaultsSettingsPage({
  params,
}: PageProps) {
  const { slug } = await params;
  const ctx = await loadConfigPageContext(slug, "/operational-defaults");
  const currentPath = `/app/orgs/${slug}/settings/operational-defaults`;

  if (ctx.progressNotStarted) {
    return (
      <div className="space-y-8">
        <ConfigPageHeader
          ctx={ctx}
          title="Operational defaults"
          description="Locale, pipeline stages, call dispositions, callback and recording policies, notifications, and custom fields."
          currentPath={currentPath}
        />
        <ConfigNotStarted ctx={ctx} />
      </div>
    );
  }

  const orgId = ctx.membership.organizationId;
  const actor = ctx.user;

  const [
    locale,
    stages,
    dispositions,
    callback,
    recording,
    notifications,
    fields,
  ] = await Promise.all([
    getLocaleSettings({ actor, organizationId: orgId }),
    listLeadStages({ actor, organizationId: orgId }),
    listCallDispositions({ actor, organizationId: orgId }),
    getCallbackPolicy({ actor, organizationId: orgId }),
    getRecordingConsentPolicy({ actor, organizationId: orgId }),
    getNotificationDefaults({ actor, organizationId: orgId }),
    listCustomFields({ actor, organizationId: orgId }),
  ]);

  const progressVersion = ctx.progress?.version;

  return (
    <div className="space-y-10">
      <ConfigPageHeader
        ctx={ctx}
        title="Operational defaults"
        description="Locale, pipeline stages, call dispositions, callback and recording policies, notifications, and custom fields."
        currentPath={currentPath}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Locale</h2>
        {locale.ok ? (
          <LocaleForm
            organizationSlug={slug}
            expectedVersion={locale.settings.version}
            canManage={ctx.canManageConfig}
            defaults={{
              locale: locale.settings.locale,
              defaultLanguage: locale.settings.defaultLanguage,
              dateDisplayPreference: locale.settings.dateDisplayPreference,
              timeDisplayPreference: locale.settings.timeDisplayPreference,
              numberDisplayPreference: locale.settings.numberDisplayPreference,
            }}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">{locale.message}</p>
        )}
        {ctx.canManageConfig && progressVersion !== undefined ? (
          <MarkSectionCompleteForm
            organizationSlug={slug}
            expectedVersion={progressVersion}
            section="LOCALE"
            nextSection="LEAD_STAGES"
            label="Mark locale complete"
          />
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Lead stages</h2>
        <LeadStagesForm
          organizationSlug={slug}
          canManage={ctx.canManageConfig}
          initialStages={
            stages.ok
              ? stages.stages.map((stage) => ({
                  key: stage.key,
                  label: stage.label,
                  isActive: stage.isActive,
                  displayOrder: stage.displayOrder,
                  classification: stage.classification,
                  isDefault: stage.isDefault,
                }))
              : []
          }
        />
        {ctx.canManageConfig && progressVersion !== undefined ? (
          <MarkSectionCompleteForm
            organizationSlug={slug}
            expectedVersion={progressVersion}
            section="LEAD_STAGES"
            nextSection="CALL_DISPOSITIONS"
            label="Mark lead stages complete"
          />
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Call dispositions</h2>
        <DispositionsForm
          organizationSlug={slug}
          canManage={ctx.canManageConfig}
          initialDispositions={
            dispositions.ok
              ? dispositions.dispositions.map((row) => ({
                  key: row.key,
                  label: row.label,
                  isActive: row.isActive,
                  displayOrder: row.displayOrder,
                  expectsFollowUp: row.expectsFollowUp,
                  isTerminal: row.isTerminal,
                }))
              : []
          }
        />
        {ctx.canManageConfig && progressVersion !== undefined ? (
          <MarkSectionCompleteForm
            organizationSlug={slug}
            expectedVersion={progressVersion}
            section="CALL_DISPOSITIONS"
            nextSection="CALLBACK_POLICY"
            label="Mark dispositions complete"
          />
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Callback policy</h2>
        {callback.ok ? (
          <CallbackPolicyForm
            organizationSlug={slug}
            expectedVersion={callback.policy.version}
            canManage={ctx.canManageConfig}
            defaults={{
              defaultWindowMinutes: callback.policy.defaultWindowMinutes,
              maxSuggestedAttempts: callback.policy.maxSuggestedAttempts,
              minSpacingMinutes: callback.policy.minSpacingMinutes,
              businessHoursOnly: callback.policy.businessHoursOnly,
              defaultAssignmentBehavior:
                callback.policy.defaultAssignmentBehavior,
            }}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">{callback.message}</p>
        )}
        {ctx.canManageConfig && progressVersion !== undefined ? (
          <MarkSectionCompleteForm
            organizationSlug={slug}
            expectedVersion={progressVersion}
            section="CALLBACK_POLICY"
            nextSection="RECORDING_CONSENT"
            label="Mark callback policy complete"
          />
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recording and consent</h2>
        {recording.ok ? (
          <RecordingConsentForm
            organizationSlug={slug}
            expectedVersion={recording.policy.version}
            canManage={ctx.canManageConfig}
            defaults={{
              recordingEnabled: recording.policy.recordingEnabled,
              transcriptionEnabled: recording.policy.transcriptionEnabled,
              consentCaptureRequired: recording.policy.consentCaptureRequired,
              disclosureTextPlaceholder:
                recording.policy.disclosureTextPlaceholder,
              retentionDays: recording.policy.retentionDays,
              accessDefault: recording.policy.accessDefault,
              reviewRequired: recording.policy.reviewRequired,
            }}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">{recording.message}</p>
        )}
        {ctx.canManageConfig && progressVersion !== undefined ? (
          <MarkSectionCompleteForm
            organizationSlug={slug}
            expectedVersion={progressVersion}
            section="RECORDING_CONSENT"
            nextSection="NOTIFICATIONS"
            label="Mark recording consent complete"
          />
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Notification defaults</h2>
        {notifications.ok ? (
          <NotificationDefaultsForm
            organizationSlug={slug}
            expectedVersion={notifications.defaults.version}
            canManage={ctx.canManageConfig}
            defaults={{
              escalationContactLabel:
                notifications.defaults.escalationContactLabel,
              escalationContactEmail:
                notifications.defaults.escalationContactEmail,
              notificationCategories:
                notifications.defaults.notificationCategories,
              enabledChannels: notifications.defaults.enabledChannels,
              thresholdPlaceholders:
                notifications.defaults.thresholdPlaceholders,
            }}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">{notifications.message}</p>
        )}
        {ctx.canManageConfig && progressVersion !== undefined ? (
          <MarkSectionCompleteForm
            organizationSlug={slug}
            expectedVersion={progressVersion}
            section="NOTIFICATIONS"
            nextSection="CUSTOM_FIELDS"
            label="Mark notifications complete"
          />
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Custom fields</h2>
        <CustomFieldsManager
          organizationSlug={slug}
          canManage={ctx.canManageConfig}
          fields={
            fields.ok
              ? fields.fields.map((field) => ({
                  id: field.id,
                  key: field.key,
                  label: field.label,
                  description: field.description,
                  dataType: field.dataType,
                  required: field.required,
                  isActive: field.isActive,
                  displayOrder: field.displayOrder,
                  options: field.options,
                  scope: field.scope,
                  version: field.version,
                }))
              : []
          }
        />
        {ctx.canManageConfig && progressVersion !== undefined ? (
          <MarkSectionCompleteForm
            organizationSlug={slug}
            expectedVersion={progressVersion}
            section="CUSTOM_FIELDS"
            nextSection="REVIEW"
            label="Mark custom fields complete"
          />
        ) : null}
      </section>

      {ctx.canManageConfig && progressVersion !== undefined ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Review</h2>
          <p className="text-sm text-[var(--muted)]">
            Mark configuration review complete when the sections above look
            right. This does not change Phase 3A onboarding readiness.
          </p>
          <MarkSectionCompleteForm
            organizationSlug={slug}
            expectedVersion={progressVersion}
            section="REVIEW"
            label="Complete configuration review"
          />
        </section>
      ) : null}
    </div>
  );
}
