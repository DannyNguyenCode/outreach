import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AddChannelForm,
  AddContactForm,
  ArchiveChannelForm,
  ArchiveContactForm,
  ProspectArchiveForm,
  ProspectRestoreForm,
  RestoreContactForm,
} from "@/components/orgs/prospects/prospect-lifecycle-forms";
import { ProspectNav } from "@/components/orgs/prospects/prospect-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { getProspect } from "@/lib/orgs/prospects";

type PageProps = {
  params: Promise<{ slug: string; prospectId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Prospect · ${slug}` };
}

export default async function ProspectDetailPage({ params }: PageProps) {
  const { slug, prospectId } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/prospects/${prospectId}`,
  });
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) notFound();
    throw error;
  }
  await setActiveOrganization({
    user,
    organizationId: membership.organizationId,
  });
  const result = await getProspect({
    actor: user,
    organizationId: membership.organizationId,
    prospectId,
  });
  if (!result.ok) notFound();
  const prospect = result.prospect;
  const editable = prospect.canManage && prospect.lifecycle === "ACTIVE";

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        <Link
          href={`/app/orgs/${slug}/prospects`}
          className="underline-offset-2 hover:underline"
        >
          ← Prospects
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {prospect.displayName}
        </h1>
        <p className="text-sm text-[var(--muted)]">
          {prospect.kind.toLowerCase()} · {prospect.lifecycle.toLowerCase()} ·
          source {prospect.sourceKind.toLowerCase()}
        </p>
        {prospect.lifecycle === "MERGED" && prospect.mergedIntoProspectId ? (
          <p className="text-sm">
            Merged into{" "}
            <Link
              href={`/app/orgs/${slug}/prospects/${prospect.mergedIntoProspectId}`}
              className="underline-offset-2 hover:underline"
            >
              {prospect.mergedIntoDisplayName ?? "surviving prospect"}
            </Link>
            . This record is historical and cannot be edited.
          </p>
        ) : null}
      </div>
      <ProspectNav
        organizationSlug={slug}
        current="detail"
        canCreate={prospect.canManage}
      />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Details</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Website</dt>
            <dd>
              {prospect.websiteHref ? (
                <a
                  href={prospect.websiteHref}
                  rel="nofollow noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  {prospect.websiteDisplay}
                </a>
              ) : (
                (prospect.websiteDisplay ?? "—")
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Location</dt>
            <dd>{prospect.locationLabel ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Time zone</dt>
            <dd>{prospect.timeZone ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Updated</dt>
            <dd>{prospect.updatedAt.toISOString().slice(0, 10)}</dd>
          </div>
        </dl>
        <p className="text-sm text-[var(--muted)]">
          Stored phone and email addresses are records only. They do not grant
          calling, SMS, or email permission.
        </p>
        {editable ? (
          <p className="text-sm">
            <Link
              href={`/app/orgs/${slug}/prospects/${prospect.id}/edit`}
              className="underline-offset-2 hover:underline"
            >
              Edit prospect
            </Link>
          </p>
        ) : null}
      </section>

      {prospect.customValues.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Custom fields</h2>
          <ul className="text-sm">
            {prospect.customValues.map((value) => (
              <li key={value.definitionKey}>
                {value.label}: {value.displayValue}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Prospect communication points</h2>
        <p className="text-sm text-[var(--muted)]">
          A stored phone or email is a record, not permission to call, SMS, or
          email. Retiring a communication point archives it so later consent
          history can keep the same identity.
        </p>
        {prospect.channels.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">None.</p>
        ) : (
          <ul className="text-sm">
            {prospect.channels.map((channel) => (
              <li
                key={channel.id}
                className="flex flex-wrap items-center gap-2"
              >
                <span>
                  {channel.kind.toLowerCase()}
                  {channel.label ? ` (${channel.label})` : ""}:{" "}
                  {channel.displayValue}
                  {channel.lifecycle === "ARCHIVED" ? " (archived)" : ""}
                </span>
                {editable && channel.lifecycle === "ACTIVE" ? (
                  <ArchiveChannelForm
                    organizationSlug={slug}
                    prospectId={prospect.id}
                    channelId={channel.id}
                    expectedVersion={prospect.version}
                    label="Retire communication point"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editable ? (
          <AddChannelForm
            key={`channel-${prospect.version}`}
            organizationSlug={slug}
            prospectId={prospect.id}
            expectedVersion={prospect.version}
          />
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Contacts</h2>
        <p className="text-sm text-[var(--muted)]">
          Archived contacts stay visible as history. Restore a contact before
          editing it. At most one active contact can be primary; archiving the
          primary leaves the prospect without a primary until one is set.
        </p>
        {prospect.contacts.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No contacts yet.</p>
        ) : (
          <ul className="space-y-4">
            {prospect.contacts.map((contact) => {
              const contactEditable =
                editable && contact.lifecycle === "ACTIVE";
              return (
                <li
                  key={contact.id}
                  className="rounded-sm border border-[var(--border)] p-3"
                >
                  <p className="font-medium">
                    {contact.displayName}
                    {contact.title ? ` — ${contact.title}` : ""}
                    {contact.isPrimary ? " (primary)" : ""}
                    {contact.lifecycle === "ARCHIVED" ? " (archived)" : ""}
                  </p>
                  {contact.customValues.length > 0 ? (
                    <ul className="mt-2 text-sm">
                      {contact.customValues.map((value) => (
                        <li key={value.definitionKey}>
                          {value.label}: {value.displayValue}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <ul className="mt-2 text-sm">
                    {contact.channels.map((channel) => (
                      <li
                        key={channel.id}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <span>
                          {channel.kind.toLowerCase()}
                          {channel.label ? ` (${channel.label})` : ""}:{" "}
                          {channel.displayValue}
                          {channel.lifecycle === "ARCHIVED"
                            ? " (archived)"
                            : ""}
                        </span>
                        {contactEditable && channel.lifecycle === "ACTIVE" ? (
                          <ArchiveChannelForm
                            organizationSlug={slug}
                            prospectId={prospect.id}
                            channelId={channel.id}
                            expectedVersion={contact.version}
                            label="Retire communication point"
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {contactEditable ? (
                    <div className="mt-3 space-y-3">
                      <p className="text-sm">
                        <Link
                          href={`/app/orgs/${slug}/prospects/${prospect.id}/contacts/${contact.id}/edit`}
                          className="underline-offset-2 hover:underline"
                        >
                          Edit contact
                        </Link>
                      </p>
                      <AddChannelForm
                        organizationSlug={slug}
                        prospectId={prospect.id}
                        expectedVersion={contact.version}
                        contactId={contact.id}
                      />
                      <ArchiveContactForm
                        organizationSlug={slug}
                        prospectId={prospect.id}
                        contactId={contact.id}
                        expectedVersion={contact.version}
                      />
                    </div>
                  ) : null}
                  {editable && contact.lifecycle === "ARCHIVED" ? (
                    <div className="mt-3">
                      <RestoreContactForm
                        organizationSlug={slug}
                        prospectId={prospect.id}
                        contactId={contact.id}
                        expectedVersion={contact.version}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {editable ? (
          <AddContactForm
            key={`contact-${prospect.version}`}
            organizationSlug={slug}
            prospectId={prospect.id}
            expectedVersion={prospect.version}
            contactFields={prospect.contactFieldControls}
          />
        ) : null}
      </section>

      {prospect.duplicateCandidates.length > 0 && prospect.canManage ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Possible duplicates</h2>
          <ul className="text-sm">
            {prospect.duplicateCandidates.map((candidate) => (
              <li key={candidate.prospectId}>
                <Link
                  href={`/app/orgs/${slug}/prospects/${prospect.id}/merge?with=${candidate.prospectId}`}
                  className="underline-offset-2 hover:underline"
                >
                  Review merge with {candidate.displayName}
                </Link>{" "}
                ({candidate.reasons.join(", ")})
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {prospect.recentAudit.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Recent changes</h2>
          <ul className="text-sm text-[var(--muted)]">
            {prospect.recentAudit.map((event) => (
              <li key={event.id}>
                {event.action.replaceAll("_", " ").toLowerCase()} ·{" "}
                {event.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {prospect.canManage && prospect.lifecycle === "ACTIVE" ? (
        <ProspectArchiveForm
          key={`archive-${prospect.version}`}
          organizationSlug={slug}
          prospectId={prospect.id}
          expectedVersion={prospect.version}
        />
      ) : null}
      {prospect.canManage && prospect.lifecycle === "ARCHIVED" ? (
        <ProspectRestoreForm
          key={`restore-${prospect.version}`}
          organizationSlug={slug}
          prospectId={prospect.id}
          expectedVersion={prospect.version}
        />
      ) : null}
    </div>
  );
}
