import { describe, expect, test } from "vitest";
import {
  isDateTimeWithinHours,
  type OperatingHoursRow,
} from "@/lib/opening-hours";

// Standard weekly schedule: open 08:00-18:00 Mon-Sat, closed Sunday.
const weeklyRows: OperatingHoursRow[] = [
  { dayOfWeek: 0, openTime: "00:00", closeTime: "00:00", isClosed: true, holidayDate: null },
  { dayOfWeek: 1, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 2, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 3, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 4, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 5, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 6, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
];

// Brisbane is AEST year-round (UTC+10, no DST). A Brisbane local time
// is exactly 10h ahead of the corresponding UTC instant, which makes
// testing deterministic.
const BRISBANE = "Australia/Brisbane";

// Build a Date from Brisbane-local components. Brisbane has no DST, so
// subtracting 10h gives the UTC instant.
function brisbane(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 10, minute));
}

describe("isDateTimeWithinHours — basic bounds", () => {
  test("inside hours", () => {
    // Tuesday 2026-04-28 at 10:00 Brisbane
    const res = isDateTimeWithinHours(brisbane(2026, 4, 28, 10, 0), BRISBANE, weeklyRows);
    expect(res.ok).toBe(true);
  });

  test("exact openTime → ok (inclusive)", () => {
    const res = isDateTimeWithinHours(brisbane(2026, 4, 28, 8, 0), BRISBANE, weeklyRows);
    expect(res.ok).toBe(true);
  });

  test("exact closeTime → ok (inclusive)", () => {
    const res = isDateTimeWithinHours(brisbane(2026, 4, 28, 18, 0), BRISBANE, weeklyRows);
    expect(res.ok).toBe(true);
  });

  test("before open", () => {
    const res = isDateTimeWithinHours(brisbane(2026, 4, 28, 7, 30), BRISBANE, weeklyRows);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("BEFORE_OPEN");
      expect(res.openTime).toBe("08:00");
      expect(res.localTime).toBe("07:30");
      expect(res.weekdayName).toBe("Tuesday");
    }
  });

  test("after close", () => {
    const res = isDateTimeWithinHours(brisbane(2026, 4, 28, 19, 0), BRISBANE, weeklyRows);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("AFTER_CLOSE");
      expect(res.closeTime).toBe("18:00");
      expect(res.localTime).toBe("19:00");
    }
  });

  test("closed day (Sunday) → CLOSED_DAY", () => {
    // 2026-04-26 is a Sunday
    const res = isDateTimeWithinHours(brisbane(2026, 4, 26, 12, 0), BRISBANE, weeklyRows);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("CLOSED_DAY");
      expect(res.weekdayName).toBe("Sunday");
    }
  });

  test("no row configured for weekday → NO_HOURS_CONFIGURED", () => {
    const onlyMonday: OperatingHoursRow[] = [
      { dayOfWeek: 1, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
    ];
    const res = isDateTimeWithinHours(brisbane(2026, 4, 28, 10, 0), BRISBANE, onlyMonday);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("NO_HOURS_CONFIGURED");
  });
});

describe("isDateTimeWithinHours — holiday overrides", () => {
  test("holiday row closes an otherwise-open day", () => {
    // Tuesday 2026-04-28 — normally open, but override row marks it closed
    const withHoliday: OperatingHoursRow[] = [
      ...weeklyRows,
      {
        dayOfWeek: 2,
        openTime: "00:00",
        closeTime: "00:00",
        isClosed: true,
        // Holiday date is stored as @db.Date — construct a UTC midnight Date.
        holidayDate: new Date(Date.UTC(2026, 3, 28)),
      },
    ];
    const res = isDateTimeWithinHours(brisbane(2026, 4, 28, 10, 0), BRISBANE, withHoliday);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("CLOSED_DAY");
  });

  test("holiday row opens an otherwise-closed day (Sunday)", () => {
    // Sunday 2026-04-26 — normally closed, but holiday override opens it
    const withHoliday: OperatingHoursRow[] = [
      ...weeklyRows,
      {
        dayOfWeek: 0,
        openTime: "10:00",
        closeTime: "14:00",
        isClosed: false,
        holidayDate: new Date(Date.UTC(2026, 3, 26)),
      },
    ];
    const inside = isDateTimeWithinHours(brisbane(2026, 4, 26, 12, 0), BRISBANE, withHoliday);
    expect(inside.ok).toBe(true);

    const outside = isDateTimeWithinHours(brisbane(2026, 4, 26, 9, 30), BRISBANE, withHoliday);
    expect(outside.ok).toBe(false);
    if (!outside.ok) {
      expect(outside.reason).toBe("BEFORE_OPEN");
      expect(outside.openTime).toBe("10:00");
    }
  });
});

describe("isDateTimeWithinHours — timezone sensitivity", () => {
  test("same UTC instant reads different local time per depot timezone", () => {
    // 22:00 UTC on a Tuesday = 08:00 Brisbane (Wed) = 10:00 Auckland (Wed, NZST)
    const instant = new Date(Date.UTC(2026, 3, 28, 22, 0));
    const brisbaneRes = isDateTimeWithinHours(instant, BRISBANE, weeklyRows);
    // 08:00 Wed Brisbane — exactly at open → ok
    expect(brisbaneRes.ok).toBe(true);

    // Same instant at 10:00 Wed Auckland (NZ has DST but late April is NZST)
    const aucklandRes = isDateTimeWithinHours(instant, "Pacific/Auckland", weeklyRows);
    expect(aucklandRes.ok).toBe(true);
  });

  test("7am Brisbane fails (before open) even though same instant is 9am Auckland", () => {
    // 21:00 UTC = 07:00 Wed Brisbane = 09:00 Wed Auckland
    const instant = new Date(Date.UTC(2026, 3, 28, 21, 0));
    const brisbaneRes = isDateTimeWithinHours(instant, BRISBANE, weeklyRows);
    expect(brisbaneRes.ok).toBe(false);
    if (!brisbaneRes.ok) expect(brisbaneRes.reason).toBe("BEFORE_OPEN");

    const aucklandRes = isDateTimeWithinHours(instant, "Pacific/Auckland", weeklyRows);
    expect(aucklandRes.ok).toBe(true);
  });
});
