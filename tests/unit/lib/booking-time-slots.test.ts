import { describe, expect, test } from "vitest";
import {
  combineLocalDateTime,
  generateTimeSlots,
  getHoursRowForDate,
  splitLocalDateTime,
} from "@/lib/booking-time-slots";
import type { OperatingHoursRow } from "@/lib/opening-hours";

const weeklyRows: OperatingHoursRow[] = [
  { dayOfWeek: 0, openTime: "00:00", closeTime: "00:00", isClosed: true, holidayDate: null },
  { dayOfWeek: 1, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 2, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 3, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 4, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 5, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
  { dayOfWeek: 6, openTime: "09:00", closeTime: "16:00", isClosed: false, holidayDate: null },
];

describe("generateTimeSlots", () => {
  test("30-minute slots inclusive of open and close", () => {
    const slots = generateTimeSlots("08:00", "10:00", 30);
    expect(slots).toEqual(["08:00", "08:30", "09:00", "09:30", "10:00"]);
  });
  test("15-minute slots", () => {
    const slots = generateTimeSlots("08:00", "09:00", 15);
    expect(slots).toEqual(["08:00", "08:15", "08:30", "08:45", "09:00"]);
  });
  test("close == open → single slot", () => {
    expect(generateTimeSlots("12:00", "12:00", 30)).toEqual(["12:00"]);
  });
  test("close before open → empty", () => {
    expect(generateTimeSlots("18:00", "08:00", 30)).toEqual([]);
  });
  test("invalid times → empty", () => {
    expect(generateTimeSlots("garbage", "10:00", 30)).toEqual([]);
    expect(generateTimeSlots("", "", 30)).toEqual([]);
  });
});

describe("getHoursRowForDate", () => {
  test("resolves weekday row", () => {
    // 2026-04-28 is a Tuesday
    const row = getHoursRowForDate("2026-04-28", weeklyRows);
    expect(row?.dayOfWeek).toBe(2);
    expect(row?.openTime).toBe("08:00");
  });
  test("resolves Saturday row (different hours)", () => {
    // 2026-05-02 is a Saturday
    const row = getHoursRowForDate("2026-05-02", weeklyRows);
    expect(row?.dayOfWeek).toBe(6);
    expect(row?.closeTime).toBe("16:00");
  });
  test("resolves closed Sunday row", () => {
    // 2026-04-26 is a Sunday
    const row = getHoursRowForDate("2026-04-26", weeklyRows);
    expect(row?.isClosed).toBe(true);
  });
  test("holiday override wins over weekday row", () => {
    const rows: OperatingHoursRow[] = [
      ...weeklyRows,
      {
        dayOfWeek: 2,
        openTime: "10:00",
        closeTime: "14:00",
        isClosed: false,
        holidayDate: new Date(Date.UTC(2026, 3, 28)),
      },
    ];
    const row = getHoursRowForDate("2026-04-28", rows);
    expect(row?.openTime).toBe("10:00");
    expect(row?.closeTime).toBe("14:00");
  });
  test("returns null when no row for the weekday", () => {
    const onlyMonday: OperatingHoursRow[] = [
      { dayOfWeek: 1, openTime: "08:00", closeTime: "18:00", isClosed: false, holidayDate: null },
    ];
    expect(getHoursRowForDate("2026-04-28", onlyMonday)).toBeNull();
  });
  test("returns null for empty / malformed date", () => {
    expect(getHoursRowForDate("", weeklyRows)).toBeNull();
    expect(getHoursRowForDate("not-a-date", weeklyRows)).toBeNull();
  });
});

describe("splitLocalDateTime / combineLocalDateTime", () => {
  test("roundtrip", () => {
    const combined = combineLocalDateTime("2026-04-28", "09:30");
    expect(combined).toBe("2026-04-28T09:30");
    const split = splitLocalDateTime(combined);
    expect(split).toEqual({ date: "2026-04-28", time: "09:30" });
  });
  test("combine drops to empty when a side is missing", () => {
    expect(combineLocalDateTime("", "09:30")).toBe("");
    expect(combineLocalDateTime("2026-04-28", "")).toBe("");
  });
  test("split handles partial inputs", () => {
    expect(splitLocalDateTime("")).toEqual({ date: "", time: "" });
    expect(splitLocalDateTime("2026-04-28")).toEqual({ date: "2026-04-28", time: "" });
    expect(splitLocalDateTime("2026-04-28T09:30:15")).toEqual({
      date: "2026-04-28",
      time: "09:30",
    });
  });
});
