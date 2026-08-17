"use client";

import { useActionState, useMemo, useState } from "react";

import { createProspectAction } from "@/app/actions/prospects";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import { CustomFieldInputs } from "@/components/orgs/prospects/custom-field-inputs";
import {
  customValuesToPayload,
  type CustomFieldFormControl,
} from "@/lib/orgs/prospect-validation";

type ChannelDraft = {
  kind: "PHONE" | "EMAIL";
  label: string;
  value: string;
};

type ContactDraft = {
  firstName: string;
  lastName: string;
  title: string;
  isPrimary: boolean;
  channels: ChannelDraft[];
  customValues: Record<string, unknown>;
};

const emptyChannel = (): ChannelDraft => ({
  kind: "PHONE",
  label: "",
  value: "",
});

const emptyContact = (): ContactDraft => ({
  firstName: "",
  lastName: "",
  title: "",
  isPrimary: false,
  channels: [emptyChannel()],
  customValues: {},
});

type DuplicateCandidate = {
  prospectId: string;
  displayName: string;
  lifecycle: string;
  reasons: string[];
};

export function ProspectCreateForm({
  organizationSlug,
  prospectFields,
  contactFields,
}: {
  organizationSlug: string;
  prospectFields: CustomFieldFormControl[];
  contactFields: CustomFieldFormControl[];
}) {
  const [state, formAction] = useActionState(
    createProspectAction,
    initialActionState,
  );
  const [kind, setKind] = useState("BUSINESS");
  const [displayName, setDisplayName] = useState("");
  const [website, setWebsite] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [prospectCustom, setProspectCustom] = useState<Record<string, unknown>>(
    {},
  );
  const [contacts, setContacts] = useState<ContactDraft[]>([emptyContact()]);
  const [acknowledgeDuplicates, setAcknowledgeDuplicates] = useState(false);

  const candidates = (
    state.data as { candidates?: DuplicateCandidate[] } | undefined
  )?.candidates;
  const payload = useMemo(
    () =>
      JSON.stringify({
        kind,
        displayName,
        website,
        locationLabel,
        addressLine1,
        addressLine2,
        city,
        region,
        postalCode,
        countryCode,
        timeZone,
        acknowledgeDuplicates,
        contacts: contacts
          .filter(
            (contact) =>
              contact.firstName.trim().length > 0 ||
              contact.lastName.trim().length > 0,
          )
          .map((contact) => ({
            firstName: contact.firstName,
            lastName: contact.lastName,
            title: contact.title,
            isPrimary: contact.isPrimary,
            channels: contact.channels.filter((channel) =>
              channel.value.trim(),
            ),
            customValues: customValuesToPayload(contact.customValues),
          })),
        customValues: customValuesToPayload(prospectCustom),
      }),
    [
      kind,
      displayName,
      website,
      locationLabel,
      addressLine1,
      addressLine2,
      city,
      region,
      postalCode,
      countryCode,
      timeZone,
      acknowledgeDuplicates,
      contacts,
      prospectCustom,
    ],
  );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="payload" value={payload} />
      <FormStatus status={state.status} message={state.message} />
      {state.fieldErrors?.form ? (
        <FieldError id="prospect-form-error" errors={state.fieldErrors.form} />
      ) : null}

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Prospect</legend>
        <p className="text-sm text-[var(--muted)]">
          A prospect is the organization, household, or person you keep records
          about. Contacts are the people at that prospect. Saving creates a
          record; it does not mean Outreach may call or message anyone.
        </p>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Type</span>
          <select
            name="kindVisible"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            <option value="BUSINESS">Business</option>
            <option value="INDIVIDUAL">Individual</option>
            <option value="HOUSEHOLD">Household</option>
            <option value="ORGANIZATION">Organization / account</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Prospect name</span>
          <input
            name="displayNameVisible"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            maxLength={120}
            aria-invalid={Boolean(state.fieldErrors?.displayName)}
            aria-describedby="prospect-name-error"
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
          <FieldError
            id="prospect-name-error"
            errors={state.fieldErrors?.displayName}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Website</span>
          <input
            name="websiteVisible"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            maxLength={2048}
            inputMode="url"
            autoComplete="url"
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Location</span>
          <input
            name="locationVisible"
            value={locationLabel}
            onChange={(event) => setLocationLabel(event.target.value)}
            maxLength={120}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Address line 1</span>
          <input
            value={addressLine1}
            onChange={(event) => setAddressLine1(event.target.value)}
            maxLength={200}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Address line 2</span>
          <input
            value={addressLine2}
            onChange={(event) => setAddressLine2(event.target.value)}
            maxLength={200}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">City</span>
            <input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              maxLength={120}
              className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Region</span>
            <input
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              maxLength={120}
              className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Postal code</span>
            <input
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
              maxLength={20}
              className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Country code</span>
            <input
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value)}
              maxLength={2}
              className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            />
          </label>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Time zone</span>
          <input
            name="timeZoneVisible"
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            placeholder="America/Toronto"
            maxLength={64}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        <CustomFieldInputs
          fields={prospectFields}
          values={prospectCustom}
          onChange={(key, value) =>
            setProspectCustom((current) => ({ ...current, [key]: value }))
          }
          fieldErrors={state.fieldErrors}
          idPrefix="prospect-custom"
        />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">Contacts</legend>
        {contacts.map((contact, index) => (
          <div
            key={index}
            className="space-y-3 rounded-sm border border-[var(--border)] p-3"
          >
            <p className="text-sm font-medium">Contact {index + 1}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">
                <span className="font-medium">First name</span>
                <input
                  aria-label={`Contact ${index + 1} first name`}
                  value={contact.firstName}
                  onChange={(event) =>
                    setContacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, firstName: event.target.value }
                          : item,
                      ),
                    )
                  }
                  maxLength={80}
                  className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Last name</span>
                <input
                  aria-label={`Contact ${index + 1} last name`}
                  value={contact.lastName}
                  onChange={(event) =>
                    setContacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, lastName: event.target.value }
                          : item,
                      ),
                    )
                  }
                  maxLength={80}
                  className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                />
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Title / role</span>
              <input
                aria-label={`Contact ${index + 1} title`}
                value={contact.title}
                onChange={(event) =>
                  setContacts((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, title: event.target.value }
                        : item,
                    ),
                  )
                }
                maxLength={80}
                className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              />
            </label>
            {contact.channels.map((channel, channelIndex) => (
              <div key={channelIndex} className="grid gap-3 sm:grid-cols-3">
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Channel</span>
                  <select
                    aria-label={`Contact ${index + 1} channel ${channelIndex + 1} type`}
                    value={channel.kind}
                    onChange={(event) =>
                      setContacts((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                channels: item.channels.map(
                                  (entry, entryIndex) =>
                                    entryIndex === channelIndex
                                      ? {
                                          ...entry,
                                          kind: event.target.value as
                                            "PHONE" | "EMAIL",
                                        }
                                      : entry,
                                ),
                              }
                            : item,
                        ),
                      )
                    }
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                  >
                    <option value="PHONE">Phone</option>
                    <option value="EMAIL">Email</option>
                  </select>
                </label>
                <label className="block space-y-1 text-sm sm:col-span-2">
                  <span className="font-medium">Value</span>
                  <input
                    aria-label={`Contact ${index + 1} ${channel.kind.toLowerCase()} ${channelIndex + 1}`}
                    value={channel.value}
                    onChange={(event) =>
                      setContacts((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                channels: item.channels.map(
                                  (entry, entryIndex) =>
                                    entryIndex === channelIndex
                                      ? { ...entry, value: event.target.value }
                                      : entry,
                                ),
                              }
                            : item,
                        ),
                      )
                    }
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                  />
                </label>
              </div>
            ))}
            <button
              type="button"
              className="text-sm underline-offset-2 hover:underline"
              onClick={() =>
                setContacts((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          channels: [...item.channels, emptyChannel()],
                        }
                      : item,
                  ),
                )
              }
            >
              Add channel
            </button>
            <CustomFieldInputs
              fields={contactFields}
              values={contact.customValues}
              onChange={(key, value) =>
                setContacts((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          customValues: { ...item.customValues, [key]: value },
                        }
                      : item,
                  ),
                )
              }
              fieldErrors={state.fieldErrors}
              idPrefix={`contact-${index + 1}-custom`}
            />
          </div>
        ))}
        <button
          type="button"
          className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
          onClick={() => setContacts((current) => [...current, emptyContact()])}
        >
          Add contact
        </button>
      </fieldset>

      {candidates && candidates.length > 0 ? (
        <fieldset className="space-y-3 rounded-sm border border-[var(--border)] p-3">
          <legend className="text-sm font-medium">Possible duplicates</legend>
          <p className="text-sm text-[var(--muted)]">
            Review these existing records. Creating continues as a distinct
            prospect; nothing is merged automatically.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {candidates.map((candidate) => (
              <li key={candidate.prospectId}>
                {candidate.displayName} ({candidate.reasons.join(", ")})
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledgeDuplicates}
              onChange={(event) =>
                setAcknowledgeDuplicates(event.target.checked)
              }
            />
            <span>
              Continue with a distinct prospect. I have reviewed the possible
              duplicates.
            </span>
          </label>
        </fieldset>
      ) : null}

      <SubmitButton pendingLabel="Saving…">Save prospect</SubmitButton>
    </form>
  );
}
