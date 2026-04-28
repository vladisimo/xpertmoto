import { describe, expect, test } from "vitest";
import {
  validateAssignmentPreconditions,
  validateManualVehicleChoice,
} from "@/server/trpc/router/staff-booking";

describe("validateAssignmentPreconditions", () => {
  test("rejects when status is not ACTIVE/CHECKED_OUT", () => {
    const r = validateAssignmentPreconditions({
      bookingStatus: "CONFIRMED",
      bookingVehicleId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/CONFIRMED/);
  });

  test("rejects when a vehicle is already assigned", () => {
    const r = validateAssignmentPreconditions({
      bookingStatus: "ACTIVE",
      bookingVehicleId: "veh_1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Swap vehicle/);
  });

  test("accepts ACTIVE with no vehicle", () => {
    const r = validateAssignmentPreconditions({
      bookingStatus: "ACTIVE",
      bookingVehicleId: null,
    });
    expect(r.ok).toBe(true);
  });

  test("accepts CHECKED_OUT with no vehicle", () => {
    const r = validateAssignmentPreconditions({
      bookingStatus: "CHECKED_OUT",
      bookingVehicleId: null,
    });
    expect(r.ok).toBe(true);
  });
});

describe("validateManualVehicleChoice", () => {
  const baseVehicle = {
    isActive: true,
    status: "AVAILABLE",
    categoryId: "cat_125",
    depotId: "dep_gc",
    internalCode: "SCT-007",
  };
  const baseBooking = {
    bookingCategoryId: "cat_125",
    bookingPickupDepotId: "dep_gc",
  };

  test("accepts a matching available vehicle", () => {
    const r = validateManualVehicleChoice({ ...baseBooking, vehicle: baseVehicle });
    expect(r.ok).toBe(true);
  });

  test("rejects a non-AVAILABLE vehicle", () => {
    const r = validateManualVehicleChoice({
      ...baseBooking,
      vehicle: { ...baseVehicle, status: "IN_MAINTENANCE" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not available/);
  });

  test("rejects an inactive vehicle", () => {
    const r = validateManualVehicleChoice({
      ...baseBooking,
      vehicle: { ...baseVehicle, isActive: false },
    });
    expect(r.ok).toBe(false);
  });

  test("rejects a vehicle in a different category", () => {
    const r = validateManualVehicleChoice({
      ...baseBooking,
      vehicle: { ...baseVehicle, categoryId: "cat_50" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/different category/);
  });

  test("rejects a vehicle at a different depot", () => {
    const r = validateManualVehicleChoice({
      ...baseBooking,
      vehicle: { ...baseVehicle, depotId: "dep_byron" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/different depot/);
  });
});
