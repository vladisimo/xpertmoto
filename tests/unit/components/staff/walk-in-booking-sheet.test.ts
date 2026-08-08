import { describe, expect, it } from "vitest";

import { nextOpenSlot } from "@/components/staff/walk-in-booking-sheet";
import { validateBookingTimes } from "@/lib/validators/booking-times";
import type { OperatingHoursRow } from "@/lib/opening-hours";

// nextOpenSlot works in wall-clock terms: it reads `now` through local
// getters and returns a local datetime string. Every fixture below is
// therefore built with the local-component Date constructor
// (`new Date(y, m, d, h, min)`) so the expectations hold under any TZ the
// runner happens to have — including the Australia/Brisbane the jobs
// hardcode, where local dates run up to 10 hours ahead of UTC and a
// UTC-getter slip would silently pick the wrong day.
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const HOURS: OperatingHoursRow[] = [
  { dayOfWeek: 0, openTime: "00:00", closeTime: "00:00", isClosed: true, holidayDate: null }, // Sun closed
  { dayOfWeek: 1, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 2, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 3, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 4, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 5, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 6, openTime: "09:00", closeTime: "16:00", isClosed: false, holidayDate: null }, // Sat
];

/** Asserts the slot the sheet would default to also clears the sheet's validator. */
function expectWithinHours(slot: string | null) {
  expect(slot).not.toBeNull();
  const at = new Date(slot as string);
  const depot = { name: "Depot", timezone: LOCAL_TZ, operatingHours: HOURS };
  const check = validateBookingTimes({
    pickupDateTime: at,
    returnDateTime: at,
    pickupDepot: depot,
    returnDepot: depot,
  });
  expect(check.ok).toBe(true);
}

describe("nextOpenSlot", () => {
  it("during open hours → next slot boundary the same day", () => {
    // Monday 2026-08-10, 09:05 local.
    const slot = nextOpenSlot(HOURS, new Date(2026, 7, 10, 9, 5));
    expect(slot).toBe("2026-08-10T09:30");
    expectWithinHours(slot);
  });

  it("exactly on a slot boundary → that slot, not the next one", () => {
    const slot = nextOpenSlot(HOURS, new Date(2026, 7, 10, 9, 30, 45));
    expect(slot).toBe("2026-08-10T09:30");
  });

  it("before open → the same day's opening slot", () => {
    // Monday 06:20 — the old clock-based default produced 06:30 and tripped
    // the BEFORE_OPEN validation on every early walk-in.
    const slot = nextOpenSlot(HOURS, new Date(2026, 7, 10, 6, 20));
    expect(slot).toBe("2026-08-10T08:00");
    expectWithinHours(slot);
  });

  it("closing time itself is still offered", () => {
    const slot = nextOpenSlot(HOURS, new Date(2026, 7, 10, 17, 50));
    expect(slot).toBe("2026-08-10T18:00");
    expectWithinHours(slot);
  });

  it("after close → the next day's opening slot", () => {
    // Monday 18:40 → Tuesday 08:00.
    const slot = nextOpenSlot(HOURS, new Date(2026, 7, 10, 18, 40));
    expect(slot).toBe("2026-08-11T08:00");
    expectWithinHours(slot);
  });

  it("skips a closed day — Saturday after close → Monday", () => {
    // Saturday 2026-08-15 closes at 16:00; Sunday is closed.
    const slot = nextOpenSlot(HOURS, new Date(2026, 7, 15, 16, 30));
    expect(slot).toBe("2026-08-17T08:00");
    expectWithinHours(slot);
  });

  it("Sunday all day → Monday's opening slot", () => {
    const slot = nextOpenSlot(HOURS, new Date(2026, 7, 16, 11, 0));
    expect(slot).toBe("2026-08-17T08:00");
    expectWithinHours(slot);
  });

  it("late-night rollover lands on the following calendar day", () => {
    // 23:50 rounds up to 00:00 the next day, which must resolve against
    // Tuesday's row (not Monday's).
    const slot = nextOpenSlot(HOURS, new Date(2026, 7, 10, 23, 50));
    expect(slot).toBe("2026-08-11T08:00");
    expectWithinHours(slot);
  });

  it("honours a holiday-override closure", () => {
    const withHoliday: OperatingHoursRow[] = [
      ...HOURS,
      {
        dayOfWeek: 1,
        openTime: "00:00",
        closeTime: "00:00",
        isClosed: true,
        // Holiday rows are stored as UTC midnight dates.
        holidayDate: new Date(Date.UTC(2026, 7, 10)),
      },
    ];
    const slot = nextOpenSlot(withHoliday, new Date(2026, 7, 10, 9, 5));
    expect(slot).toBe("2026-08-11T08:00");
  });

  it("respects a non-half-hour opening time", () => {
    const rows = HOURS.map((h) =>
      h.dayOfWeek === 1 ? { ...h, openTime: "08:15" } : h,
    );
    expect(nextOpenSlot(rows, new Date(2026, 7, 10, 6, 0))).toBe("2026-08-10T08:15");
    expect(nextOpenSlot(rows, new Date(2026, 7, 10, 8, 20))).toBe("2026-08-10T08:45");
  });

  it("respects a custom slot interval", () => {
    expect(nextOpenSlot(HOURS, new Date(2026, 7, 10, 9, 5), 15)).toBe(
      "2026-08-10T09:15",
    );
  });

  it("returns null when the depot publishes no hours", () => {
    expect(nextOpenSlot([], new Date(2026, 7, 10, 9, 5))).toBeNull();
  });

  it("returns null when the depot is closed for the whole search window", () => {
    const allClosed = HOURS.map((h) => ({ ...h, isClosed: true }));
    expect(nextOpenSlot(allClosed, new Date(2026, 7, 10, 9, 5))).toBeNull();
  });
});
