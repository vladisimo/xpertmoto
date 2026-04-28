/**
 * Operating hours check that respects a depot's own timezone and its
 * `holidayDate` override rows.
 *
 * Used by both client (booking wizard, walk-in sheet) and server
 * (booking.quote, booking.create, staff-booking.createWalkIn) so that
 * scheduled pickup / return times are validated against the depot's
 * published hours the same way on both sides.
 *
 * Bounds are **inclusive**: `openTime ≤ localHHmm ≤ closeTime`. Rationale:
 * a pickup at the exact open time or a return at the exact close time is
 * the counter's first / last slot for the day.
 *
 * Does not hit the database — callers pass the already-loaded
 * `DepotOperatingHours` rows for the depot.
 */

export type OperatingHoursRow = {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
  holidayDate: Date | null;
};

export type HoursCheckOk = { ok: true };
export type HoursCheckFail = {
  ok: false;
  reason: "CLOSED_DAY" | "BEFORE_OPEN" | "AFTER_CLOSE" | "NO_HOURS_CONFIGURED";
  openTime?: string;
  closeTime?: string;
  localDate: string;
  localTime: string;
  weekdayName: string;
};
export type HoursCheck = HoursCheckOk | HoursCheckFail;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const WEEKDAY_LONG: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

function localiseDateTime(dateTime: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dateTime);

  const pick = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const weekdayStr = pick("weekday");
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const hour = pick("hour").padStart(2, "0");
  const minute = pick("minute");
  const dayOfWeek = WEEKDAY_INDEX[weekdayStr] ?? 1;

  return {
    dayOfWeek,
    weekdayName: WEEKDAY_LONG[dayOfWeek] ?? "Monday",
    localDate: `${year}-${month}-${day}`,
    localTime: hour === "24" ? `00:${minute}` : `${hour}:${minute}`,
  };
}

function pickApplicableRow(
  hours: OperatingHoursRow[],
  localDate: string,
  dayOfWeek: number,
): OperatingHoursRow | null {
  const holiday = hours.find((h) => {
    if (!h.holidayDate) return false;
    const hd = h.holidayDate;
    const y = hd.getUTCFullYear();
    const m = String(hd.getUTCMonth() + 1).padStart(2, "0");
    const d = String(hd.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}` === localDate;
  });
  if (holiday) return holiday;

  return hours.find((h) => h.holidayDate === null && h.dayOfWeek === dayOfWeek) ?? null;
}

export function isDateTimeWithinHours(
  dateTime: Date,
  timezone: string,
  hours: OperatingHoursRow[],
): HoursCheck {
  const local = localiseDateTime(dateTime, timezone);
  const row = pickApplicableRow(hours, local.localDate, local.dayOfWeek);

  if (!row) {
    return {
      ok: false,
      reason: "NO_HOURS_CONFIGURED",
      localDate: local.localDate,
      localTime: local.localTime,
      weekdayName: local.weekdayName,
    };
  }
  if (row.isClosed) {
    return {
      ok: false,
      reason: "CLOSED_DAY",
      localDate: local.localDate,
      localTime: local.localTime,
      weekdayName: local.weekdayName,
    };
  }
  if (local.localTime < row.openTime) {
    return {
      ok: false,
      reason: "BEFORE_OPEN",
      openTime: row.openTime,
      closeTime: row.closeTime,
      localDate: local.localDate,
      localTime: local.localTime,
      weekdayName: local.weekdayName,
    };
  }
  if (local.localTime > row.closeTime) {
    return {
      ok: false,
      reason: "AFTER_CLOSE",
      openTime: row.openTime,
      closeTime: row.closeTime,
      localDate: local.localDate,
      localTime: local.localTime,
      weekdayName: local.weekdayName,
    };
  }
  return { ok: true };
}
