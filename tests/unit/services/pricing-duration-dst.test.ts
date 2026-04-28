import { describe, expect, test } from "vitest";
import {
  calcDurationDays,
  wallClockElapsedMs,
} from "@/server/services/pricing";

// Sydney transitions:
//   - AEST → AEDT (spring forward): first Sunday of October at 02:00
//   - AEDT → AEST (fall back): first Sunday of April at 03:00
//   - QLD (Australia/Brisbane) has no DST — stays UTC+10 year-round.

describe("calcDurationDays — DST-safe", () => {
  test("24h rental in QLD (no DST) = 1 day", () => {
    const pickup = new Date("2026-04-04T10:00:00+10:00");
    const ret = new Date("2026-04-05T10:00:00+10:00");
    expect(calcDurationDays(pickup, ret, "Australia/Brisbane")).toBe(1);
  });

  test("24h rental in Sydney crossing AEDT→AEST fall-back = 1 day (not 2)", () => {
    // 3 Apr 2027 at 22:00 AEDT → 4 Apr 2027 at 22:00 AEST.
    // UTC ms elapsed is 25h because DST rolled back. Wall-clock is 24h.
    const pickup = new Date("2027-04-03T12:00:00Z"); // 22:00 AEDT (+11)
    const ret = new Date("2027-04-04T13:00:00Z"); //   22:00 AEST (+10)
    expect(calcDurationDays(pickup, ret, "Australia/Sydney")).toBe(1);
  });

  test("24h rental in Sydney crossing AEST→AEDT spring-forward = 1 day (not 0.96)", () => {
    // 3 Oct 2026 at 10:00 AEST → 4 Oct 2026 at 10:00 AEDT.
    // UTC ms elapsed is 23h because clocks sprang forward. Wall-clock is 24h.
    const pickup = new Date("2026-10-03T00:00:00Z"); // 10:00 AEST (+10)
    const ret = new Date("2026-10-03T23:00:00Z"); //   10:00 AEDT (+11)
    expect(calcDurationDays(pickup, ret, "Australia/Sydney")).toBe(1);
  });

  test("25-hour (wall-clock) rental rounds up to 2 days", () => {
    const pickup = new Date("2026-05-01T10:00:00+10:00");
    const ret = new Date("2026-05-02T11:00:00+10:00");
    expect(calcDurationDays(pickup, ret, "Australia/Brisbane")).toBe(2);
  });

  test("default Brisbane timezone still works when not specified", () => {
    const pickup = new Date("2026-05-01T10:00:00+10:00");
    const ret = new Date("2026-05-02T10:00:00+10:00");
    expect(calcDurationDays(pickup, ret)).toBe(1);
  });
});

describe("wallClockElapsedMs", () => {
  test("returns 24h in ms across a DST fall-back in Sydney", () => {
    const a = new Date("2027-04-03T12:00:00Z"); // 22:00 AEDT
    const b = new Date("2027-04-04T13:00:00Z"); // 22:00 AEST
    expect(wallClockElapsedMs(a, b, "Australia/Sydney")).toBe(24 * 60 * 60 * 1000);
  });

  test("returns 24h in ms across a DST spring-forward in Sydney", () => {
    const a = new Date("2026-10-03T00:00:00Z"); // 10:00 AEST
    const b = new Date("2026-10-03T23:00:00Z"); // 10:00 AEDT
    expect(wallClockElapsedMs(a, b, "Australia/Sydney")).toBe(24 * 60 * 60 * 1000);
  });

  test("is a no-op when both sides share the same offset (QLD)", () => {
    const a = new Date("2026-04-03T10:00:00+10:00");
    const b = new Date("2026-04-05T10:00:00+10:00");
    expect(wallClockElapsedMs(a, b, "Australia/Brisbane")).toBe(48 * 60 * 60 * 1000);
  });
});
