import {
  ConfigNotStarted,
  ConfigPageHeader,
  loadConfigPageContext,
} from "@/components/orgs/config/config-page";
import { MarkSectionCompleteForm } from "@/components/orgs/config/form-helpers";
import { TemplateCustomizeForm } from "@/components/orgs/config/template-customize-form";
import { TemplateSelectForm } from "@/components/orgs/config/template-select-form";
import { TemplateSwitchForm } from "@/components/orgs/config/template-switch-form";
import { getTemplateDefinition } from "@/lib/orgs/business-templates-registry";
import {
  getTemplateAssignment,
  listAvailableTemplates,
} from "@/lib/orgs/business-templates";
import { roleHasPermission } from "@/lib/orgs/permissions";

type PageProps = {
  params: Promise<{ slug: string }>;
};

function parseCustomization(raw: unknown): {
  confirmedFieldKeys: string[];
  notes: string;
} {
  if (!raw || typeof raw !== "object") {
    return { confirmedFieldKeys: [], notes: "" };
  }
  const record = raw as Record<string, unknown>;
  const keys = Array.isArray(record.confirmedFieldKeys)
    ? record.confirmedFieldKeys.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const notes = typeof record.notes === "string" ? record.notes : "";
  return { confirmedFieldKeys: keys, notes };
}

export default async function BusinessTemplateSettingsPage({
  params,
}: PageProps) {
  const { slug } = await params;
  const ctx = await loadConfigPageContext(slug, "/business-template");
  const currentPath = `/app/orgs/${slug}/settings/business-template`;

  if (ctx.progressNotStarted) {
    return (
      <div className="space-y-8">
        <ConfigPageHeader
          ctx={ctx}
          title="Business template"
          description="Select a platform template to guide configuration. Suggestions are never auto-activated."
          currentPath={currentPath}
        />
        <ConfigNotStarted ctx={ctx} />
      </div>
    );
  }

  const canReadTemplates = roleHasPermission(
    ctx.membership.role,
    "org.templates.read",
  );

  const [templatesResult, assignmentResult] = await Promise.all([
    canReadTemplates
      ? listAvailableTemplates({
          actor: ctx.user,
          organizationId: ctx.membership.organizationId,
        })
      : Promise.resolve(null),
    canReadTemplates
      ? getTemplateAssignment({
          actor: ctx.user,
          organizationId: ctx.membership.organizationId,
        })
      : Promise.resolve(null),
  ]);

  const templates = templatesResult?.ok
    ? templatesResult.templates.map((template) => ({
        key: template.key,
        label: template.label,
        description: template.description,
        suggestedCustomFields: template.suggestedCustomFields.map((field) => ({
          key: field.key,
          label: field.label,
          scope: field.scope,
        })),
      }))
    : [];

  const assignment = assignmentResult?.ok ? assignmentResult.assignment : null;
  const definition = assignment
    ? getTemplateDefinition(assignment.templateKey)
    : null;
  const customization = assignment
    ? parseCustomization(assignment.customization)
    : { confirmedFieldKeys: [], notes: "" };

  return (
    <div className="space-y-8">
      <ConfigPageHeader
        ctx={ctx}
        title="Business template"
        description="Select a platform template to guide configuration. Suggestions are never auto-activated."
        currentPath={currentPath}
      />

      {!assignment ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Select template</h2>
          {ctx.canManageTemplates ? (
            <TemplateSelectForm organizationSlug={slug} templates={templates} />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              No business template has been selected yet.
            </p>
          )}
        </section>
      ) : (
        <>
          <section className="space-y-2 text-sm">
            <h2 className="text-lg font-semibold">Current template</h2>
            <p>
              <span className="font-medium">
                {definition?.label ?? assignment.templateKey}
              </span>{" "}
              <span className="text-[var(--muted)]">
                (definition v{assignment.templateDefinitionVersion})
              </span>
            </p>
            <p className="text-[var(--muted)]">
              {definition?.description ?? ""}
            </p>
          </section>

          {ctx.canManageTemplates && definition ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Customization</h2>
              <TemplateCustomizeForm
                organizationSlug={slug}
                expectedVersion={assignment.version}
                suggestedFields={definition.suggestedCustomFields.map(
                  (field) => ({
                    key: field.key,
                    label: field.label,
                    scope: field.scope,
                    dataType: field.dataType,
                  }),
                )}
                confirmedFieldKeys={customization.confirmedFieldKeys}
                notes={customization.notes}
              />
            </section>
          ) : null}

          {ctx.canManageTemplates ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Switch template</h2>
              <TemplateSwitchForm
                organizationSlug={slug}
                expectedVersion={assignment.version}
                currentKey={assignment.templateKey}
                templates={templates}
              />
            </section>
          ) : null}
        </>
      )}

      {ctx.canManageConfig && ctx.progress ? (
        <MarkSectionCompleteForm
          organizationSlug={slug}
          expectedVersion={ctx.progress.version}
          section="BUSINESS_TEMPLATE"
          nextSection="LOCALE"
          label="Mark business template complete"
        />
      ) : null}
    </div>
  );
}
