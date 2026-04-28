import { describe, expect, test } from "vitest";
import { classifyRowAction } from "@/server/services/etoll";
import { validateResolveInputs } from "@/server/trpc/router/etoll";

describe("classifyRowAction", () => {
  const NEVER_SEEN = { existingInfringement: false, existingUnmatched: null, matched: true };

  test("skips when an Infringement already exists (pure idempotency)", () => {
    const action = classifyRowAction({ ...NEVER_SEEN, existingInfringement: true });
    expect(action).toEqual({ type: "skip-duplicate" });
  });

  test("skip-duplicate wins over dismissed-unmatched when both are present", () => {
    // If we ever end up with both an Infringement and a dismissed row for the
    // same hash (shouldn't happen, but is cheap to guard), treat as duplicate
    // rather than a dismissed row.
    const action = classifyRowAction({
      existingInfringement: true,
      existingUnmatched: { resolvedAt: new Date(), resolvedAction: "DISMISSED" },
      matched: false,
    });
    expect(action).toEqual({ type: "skip-duplicate" });
  });

  test("previously dismissed rows are skipped so they don't re-surface", () => {
    const action = classifyRowAction({
      existingInfringement: false,
      existingUnmatched: { resolvedAt: new Date(), resolvedAction: "DISMISSED" },
      matched: true,
    });
    expect(action).toEqual({ type: "skip-dismissed" });
  });

  test("matched, brand-new row → create a fresh Infringement", () => {
    expect(classifyRowAction(NEVER_SEEN)).toEqual({ type: "create-new" });
  });

  test("matched with a pending unmatched row → create + auto-resolve the row", () => {
    const action = classifyRowAction({
      existingInfringement: false,
      existingUnmatched: { resolvedAt: null, resolvedAction: null },
      matched: true,
    });
    expect(action).toEqual({ type: "create-and-resolve-existing" });
  });

  test("matched with an auto-resolved prior row → plain create-new (Infringement is the source of truth)", () => {
    // The only non-dismissed, already-resolved state we emit is AUTO_MATCHED,
    // which always carries an infringement. If we see it here without a
    // matching Infringement, it's a stale row — create a new Infringement
    // rather than acting on the stale row.
    const action = classifyRowAction({
      existingInfringement: false,
      existingUnmatched: { resolvedAt: new Date(), resolvedAction: "AUTO_MATCHED" },
      matched: true,
    });
    expect(action).toEqual({ type: "create-new" });
  });

  test("unmatched, brand-new row → record so staff can resolve it", () => {
    const action = classifyRowAction({
      existingInfringement: false,
      existingUnmatched: null,
      matched: false,
    });
    expect(action).toEqual({ type: "record-unmatched" });
  });

  test("unmatched with an existing pending row → no-op refresh (avoid re-inserting)", () => {
    const action = classifyRowAction({
      existingInfringement: false,
      existingUnmatched: { resolvedAt: null, resolvedAction: null },
      matched: false,
    });
    expect(action).toEqual({ type: "refresh-unmatched" });
  });
});

describe("validateResolveInputs", () => {
  const BASE = {
    alreadyResolved: false,
    bookingVehicleId: null,
    selectedVehicleId: "veh_1",
    linkMode: "none" as const,
    hasBookingId: false,
    hasCustomerId: false,
  };

  test("accepts no-customer mode with just a vehicle", () => {
    expect(validateResolveInputs(BASE).ok).toBe(true);
  });

  test("rejects when the row is already resolved (race with the sync worker)", () => {
    const r = validateResolveInputs({ ...BASE, alreadyResolved: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already been resolved/);
  });

  test("booking mode requires a bookingId", () => {
    const r = validateResolveInputs({ ...BASE, linkMode: "booking", hasBookingId: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Missing booking/);
  });

  test("booking mode rejects a booking bound to a different vehicle", () => {
    const r = validateResolveInputs({
      ...BASE,
      linkMode: "booking",
      hasBookingId: true,
      bookingVehicleId: "veh_OTHER",
      selectedVehicleId: "veh_1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not for the selected vehicle/);
  });

  test("booking mode rejects when the booking lookup returned nothing", () => {
    const r = validateResolveInputs({
      ...BASE,
      linkMode: "booking",
      hasBookingId: true,
      bookingVehicleId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Booking not found/);
  });

  test("booking mode accepts a booking whose vehicle matches the selection", () => {
    const r = validateResolveInputs({
      ...BASE,
      linkMode: "booking",
      hasBookingId: true,
      bookingVehicleId: "veh_1",
      selectedVehicleId: "veh_1",
    });
    expect(r.ok).toBe(true);
  });

  test("customer mode requires a customerId", () => {
    const r = validateResolveInputs({ ...BASE, linkMode: "customer", hasCustomerId: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Missing customer/);
  });

  test("customer mode accepts when a customerId is provided", () => {
    const r = validateResolveInputs({ ...BASE, linkMode: "customer", hasCustomerId: true });
    expect(r.ok).toBe(true);
  });
});
