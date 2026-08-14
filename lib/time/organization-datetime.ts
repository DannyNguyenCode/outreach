import { Temporal } from "@js-temporal/polyfill";

export type DstDisambiguation = "earlier" | "later";

export type OrganizationWallTimeSuccess = {
  ok: true;
  instant: Date | null;
  timeZone: string | null;
};

export type OrganizationWallTimeFailure = {
  ok: false;
  code: "missing_timezone" | "invalid" | "dst_gap" | "dst_overlap";
  message: string;
};

export type OrganizationWallTimeResult =
  OrganizationWallTimeSuccess | OrganizationWallTimeFailure;

const DATETIME_LOCAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function missingOrganizationTimeZoneMessage(
  settingsHref?: string | null,
): string {
  if (settingsHref) {
    return `Set this organization's time zone in settings (${settingsHref}) before using effective dates.`;
  }
  return "Set this organization's time zone in settings before using effective dates.";
}

export function parseDstDisambiguation(
  raw: unknown,
): DstDisambiguation | undefined {
  if (raw === "earlier" || raw === "later") {
    return raw;
  }
  return undefined;
}

export function isEmptyWallTime(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Convert a datetime-local wall time in the organization's IANA zone to a UTC
 * Date. Absolute ISO-8601 / Date values are already instants and are kept as
 * UTC. Missing timezone rejects dated values; undated (empty) values are null.
 */
export function parseOrganizationWallTime(input: {
  value: unknown;
  timeZone: string | null | undefined;
  disambiguation?: unknown;
  settingsHref?: string | null;
}): OrganizationWallTimeResult {
  if (isEmptyWallTime(input.value)) {
    return { ok: true, instant: null, timeZone: input.timeZone ?? null };
  }

  const timeZone = input.timeZone?.trim() || null;
  if (!timeZone) {
    return {
      ok: false,
      code: "missing_timezone",
      message: missingOrganizationTimeZoneMessage(input.settingsHref),
    };
  }

  if (input.value instanceof Date) {
    if (Number.isNaN(input.value.getTime())) {
      return invalidTime();
    }
    return { ok: true, instant: input.value, timeZone };
  }

  if (typeof input.value !== "string") {
    return invalidTime();
  }

  const trimmed = input.value.trim();
  if (!trimmed) {
    return { ok: true, instant: null, timeZone };
  }

  if (isAbsoluteInstantString(trimmed)) {
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      return invalidTime();
    }
    return { ok: true, instant: date, timeZone };
  }

  const match = DATETIME_LOCAL_RE.exec(trimmed);
  if (!match) {
    return invalidTime();
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);

  let plain: Temporal.PlainDateTime;
  try {
    plain = Temporal.PlainDateTime.from(
      { year, month, day, hour, minute, second },
      { overflow: "reject" },
    );
  } catch {
    return invalidTime();
  }

  const disambiguation = parseDstDisambiguation(input.disambiguation);

  try {
    const zoned = plain.toZonedDateTime(timeZone, {
      disambiguation: "reject",
    });
    return {
      ok: true,
      instant: new Date(zoned.toInstant().epochMilliseconds),
      timeZone,
    };
  } catch (error) {
    if (!isTemporalRangeError(error)) {
      return invalidTime();
    }
  }

  let earlier: Temporal.ZonedDateTime;
  let later: Temporal.ZonedDateTime;
  try {
    earlier = plain.toZonedDateTime(timeZone, { disambiguation: "earlier" });
    later = plain.toZonedDateTime(timeZone, { disambiguation: "later" });
  } catch {
    return {
      ok: false,
      code: "dst_gap",
      message: dstGapMessage(timeZone),
    };
  }

  const earlierMatches =
    Temporal.PlainDateTime.compare(earlier.toPlainDateTime(), plain) === 0;
  const laterMatches =
    Temporal.PlainDateTime.compare(later.toPlainDateTime(), plain) === 0;
  if (
    earlierMatches &&
    laterMatches &&
    earlier.epochNanoseconds !== later.epochNanoseconds
  ) {
    if (!disambiguation) {
      return {
        ok: false,
        code: "dst_overlap",
        message: dstOverlapMessage(timeZone),
      };
    }
    const chosen = disambiguation === "earlier" ? earlier : later;
    return {
      ok: true,
      instant: new Date(chosen.toInstant().epochMilliseconds),
      timeZone,
    };
  }

  return {
    ok: false,
    code: "dst_gap",
    message: dstGapMessage(timeZone),
  };
}

export function formatOrganizationWallTime(
  instant: Date | null | undefined,
  timeZone: string | null | undefined,
): { wall: string; disambiguation: DstDisambiguation | "" } {
  if (!instant || Number.isNaN(instant.getTime()) || !timeZone?.trim()) {
    return { wall: "", disambiguation: "" };
  }

  const zoned = Temporal.Instant.fromEpochMilliseconds(
    instant.getTime(),
  ).toZonedDateTimeISO(timeZone);
  const wall = `${pad(zoned.year, 4)}-${pad(zoned.month, 2)}-${pad(zoned.day, 2)}T${pad(zoned.hour, 2)}:${pad(zoned.minute, 2)}`;

  const plain = zoned.toPlainDateTime();
  try {
    plain.toZonedDateTime(timeZone, { disambiguation: "reject" });
    return { wall, disambiguation: "" };
  } catch {
    const earlier = plain.toZonedDateTime(timeZone, {
      disambiguation: "earlier",
    });
    const later = plain.toZonedDateTime(timeZone, { disambiguation: "later" });
    const overlap =
      Temporal.PlainDateTime.compare(earlier.toPlainDateTime(), plain) === 0 &&
      Temporal.PlainDateTime.compare(later.toPlainDateTime(), plain) === 0 &&
      earlier.epochNanoseconds !== later.epochNanoseconds;
    if (!overlap) {
      return { wall, disambiguation: "" };
    }
    return {
      wall,
      disambiguation:
        zoned.epochNanoseconds === later.epochNanoseconds ? "later" : "earlier",
    };
  }
}

export function resolveEffectiveRange(input: {
  effectiveFrom: unknown;
  effectiveUntil: unknown;
  effectiveFromDisambiguation?: unknown;
  effectiveUntilDisambiguation?: unknown;
  timeZone: string | null | undefined;
  settingsHref?: string | null;
}):
  | {
      ok: true;
      effectiveFrom: Date | null;
      effectiveUntil: Date | null;
    }
  | (OrganizationWallTimeFailure & { fieldErrors: Record<string, string[]> }) {
  const from = parseOrganizationWallTime({
    value: input.effectiveFrom,
    timeZone: input.timeZone,
    disambiguation: input.effectiveFromDisambiguation,
    settingsHref: input.settingsHref,
  });
  if (!from.ok) {
    return withField("effectiveFrom", from);
  }
  const until = parseOrganizationWallTime({
    value: input.effectiveUntil,
    timeZone: input.timeZone,
    disambiguation: input.effectiveUntilDisambiguation,
    settingsHref: input.settingsHref,
  });
  if (!until.ok) {
    return withField("effectiveUntil", until);
  }
  if (
    from.instant &&
    until.instant &&
    until.instant.getTime() <= from.instant.getTime()
  ) {
    return {
      ok: false,
      code: "invalid",
      message: "Effective until must be after effective from.",
      fieldErrors: {
        effectiveUntil: ["Effective until must be after effective from."],
      },
    };
  }
  return {
    ok: true,
    effectiveFrom: from.instant,
    effectiveUntil: until.instant,
  };
}

function withField(
  field: string,
  failure: OrganizationWallTimeFailure,
): OrganizationWallTimeFailure & { fieldErrors: Record<string, string[]> } {
  return { ...failure, fieldErrors: { [field]: [failure.message] } };
}

function invalidTime(): OrganizationWallTimeFailure {
  return {
    ok: false,
    code: "invalid",
    message: "Enter a valid date and time.",
  };
}

function dstGapMessage(timeZone: string): string {
  return `This local time does not exist in ${timeZone} because of daylight saving. Choose a valid time.`;
}

function dstOverlapMessage(timeZone: string): string {
  return `This local time occurs twice in ${timeZone}. Choose the earlier or later occurrence.`;
}

function isAbsoluteInstantString(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}

function isTemporalRangeError(error: unknown): boolean {
  return error instanceof RangeError;
}

function pad(value: number, size: number): string {
  return String(value).padStart(size, "0");
}
