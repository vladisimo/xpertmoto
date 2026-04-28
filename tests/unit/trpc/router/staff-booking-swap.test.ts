import { describe, expect, test } from "vitest";
import { validateSwapPreconditions } from "@/server/trpc/router/staff-booking";

const baseCandidate = {
  id: "veh_new",
  isActive: true,
  status: "AVAILABLE",
  categoryId: "cat_125",
};

describe("validateSwapPreconditions", () => {
  test("accepts an active, available, same-category candidate", () => {
    const r = validateSwapPreconditions({
      bookingStatus: "ACTIVE",
      currentVehicleId: "veh_old",
      candidate: baseCandidate,
      bookingCategoryId: "cat_125",
    });
    expect(r.ok).toBe(true);
  });

  test("rejects when booking is in a non-eligible status", () => {
    const r = validateSwapPreconditions({
      bookingStatus: "CONFIRMED",
      currentVehicleId: "veh_old",
      candidate: baseCandidate,
      bookingCategoryId: "cat_125",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/status CONFIRMED/);
  });

  test("rejects when booking has no current vehicle", () => {
    const r = validateSwapPreconditions({
      bookingStatus: "ACTIVE",
      currentVehicleId: null,
      candidate: baseCandidate,
      bookingCategoryId: "cat_125",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no assigned vehicle/);
  });

  test("rejects picking the same vehicle that's currently assigned", () => {
    const r = validateSwapPreconditions({
      bookingStatus: "ACTIVE",
      currentVehicleId: "veh_new",
      candidate: baseCandidate,
      bookingCategoryId: "cat_125",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/same as the current/);
  });

  test("rejects a candidate that is not AVAILABLE", () => {
    const r = validateSwapPreconditions({
      bookingStatus: "ACTIVE",
      currentVehicleId: "veh_old",
      candidate: { ...baseCandidate, status: "IN_MAINTENANCE" },
      bookingCategoryId: "cat_125",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not available/);
  });

  test("rejects a candidate in a different category", () => {
    const r = validateSwapPreconditions({
      bookingStatus: "ACTIVE",
      currentVehicleId: "veh_old",
      candidate: { ...baseCandidate, categoryId: "cat_50" },
      bookingCategoryId: "cat_125",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/same category/);
  });

  test("allows CHECKED_OUT and OVERDUE statuses", () => {
    for (const s of ["CHECKED_OUT", "OVERDUE"]) {
      const r = validateSwapPreconditions({
        bookingStatus: s,
        currentVehicleId: "veh_old",
        candidate: baseCandidate,
        bookingCategoryId: "cat_125",
      });
      expect(r.ok).toBe(true);
    }
  });
});
