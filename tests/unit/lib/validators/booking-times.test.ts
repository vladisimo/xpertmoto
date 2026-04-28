import { describe, expect, test } from "vitest";
import {
  validateBookingTimes,
  type DepotForTimeCheck,
} from "@/lib/validators/booking-times";
import type { OperatingHoursRow } from "@/lib/opening-hours";

const BRISBANE = "Australia/Brisbane";

const openWeekdaysOnly: OperatingHoursRow[] = [
  { dayOfWeek: 0, openTime: "00:00", closeTime: "00:00", isClosed: true, holidayDate: null },
  { dayOfWeek: 1, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 2, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 3, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 4, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 5, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 6, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
];

const goldCoast: DepotForTimeCheck = {
  name: "Gold Coast",
  timezone: BRISBANE,
  operatingHours: openWeekdaysOnly,
};

function brisbane(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 10, minute));
}

describe("validateBookingTimes", () => {
  test("ok when both endpoints inside hours", () => {
    const res = validateBookingTimes({
      // Tue 2026-04-28 10:00 Brisbane → Wed 2026-04-29 17:00 Brisbane
      pickupDateTime: brisbane(2026, 4, 28, 10, 0),
      returnDateTime: brisbane(2026, 4, 29, 17, 0),
      pickupDepot: goldCoast,
      returnDepot: goldCoast,
    });
    expect(res.ok).toBe(true);
  });

  test("pickup outside hours → error on pickupDateTime", () => {
    const res = validateBookingTimes({
      // Sunday 2026-04-26 10:00 Brisbane → depot closed Sundays
      pickupDateTime: brisbane(2026, 4, 26, 10, 0),
      returnDateTime: brisbane(2026, 4, 27, 17, 0),
      pickupDepot: goldCoast,
      returnDepot: goldCoast,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.field).toBe("pickupDateTime");
      expect(res.message).toContain("Gold Coast");
      expect(res.message).toContain("Sunday");
    }
  });

  test("return outside hours → error on returnDateTime", () => {
    const res = validateBookingTimes({
      pickupDateTime: brisbane(2026, 4, 28, 10, 0),
      // Wednesday 22:00 Brisbane — after close
      returnDateTime: brisbane(2026, 4, 29, 22, 0),
      pickupDepot: goldCoast,
      returnDepot: goldCoast,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.field).toBe("returnDateTime");
      expect(res.message).toContain("18:00");
      expect(res.message).toContain("22:00");
    }
  });

  test("both bad → pickup error reported first", () => {
    const res = validateBookingTimes({
      // Both on Sunday — depot closed
      pickupDateTime: brisbane(2026, 4, 26, 5, 0),
      returnDateTime: brisbane(2026, 4, 26, 22, 0),
      pickupDepot: goldCoast,
      returnDepot: goldCoast,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.field).toBe("pickupDateTime");
  });

  test("one-way rental: pickup depot ok, return depot closed that day", () => {
    // Gold Coast closed Sundays; Byron Bay open Sundays.
    const byronBay: DepotForTimeCheck = {
      name: "Byron Bay",
      timezone: BRISBANE,
      operatingHours: openWeekdaysOnly.map((r) =>
        r.dayOfWeek === 0
          ? { ...r, openTime: "09:00", closeTime: "17:00", isClosed: false }
          : r,
      ),
    };
    const res = validateBookingTimes({
      // Tuesday pickup from Gold Coast, Sunday return at Byron Bay — both should pass
      pickupDateTime: brisbane(2026, 4, 28, 10, 0),
      returnDateTime: brisbane(2026, 5, 3, 12, 0),
      pickupDepot: goldCoast,
      returnDepot: byronBay,
    });
    expect(res.ok).toBe(true);

    // But a Sunday return at Gold Coast (closed) should fail
    const res2 = validateBookingTimes({
      pickupDateTime: brisbane(2026, 4, 28, 10, 0),
      returnDateTime: brisbane(2026, 5, 3, 12, 0),
      pickupDepot: goldCoast,
      returnDepot: goldCoast,
    });
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.field).toBe("returnDateTime");
      expect(res2.message).toContain("Gold Coast");
    }
  });
});
