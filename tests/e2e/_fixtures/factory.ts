import { expect } from "@playwright/test";
import type { Api } from "./api";
import { e2ePrisma } from "./db";

/**
 * Per-spec data factories. Mutating specs MUST create their own rows via
 * these helpers (never mutate seeded `QA-*` fixtures — they're shared across
 * the suite and a retry would find them consumed). The factories run the
 * REAL tRPC mutations, so a broken booking.create fails loudly in setup —
 * itself a front-end-relevant signal.
 *
 * Stub-Stripe chain (the default e2e profile): booking.create issues
 * pi_stub_* / pi_bond_stub_* intents with status "succeeded";
 * booking.confirmPayment trusts them and performs the full confirm
 * side-effects — CONFIRMED status, vehicle allocation, Payment SUCCEEDED,
 * Invoice issued, BondLedger HELD.
 */

const refData = async () => {
  const depot = await e2ePrisma.depot.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  // Only categories with bookable stock — the seed puts all vehicles in one.
  const category = await e2ePrisma.vehicleCategory.findFirst({
    where: { isActive: true, vehicles: { some: { status: "AVAILABLE" } } },
    select: { id: true },
  });
  if (!depot || !category) throw new Error("factory: seed missing active depot/category");
  return { depotId: depot.id, categoryId: category.id };
};

/**
 * Stagger booking windows so parallel workers don't fight over the same
 * vehicles/dates (single depot+category allocation lock). Each call gets its
 * own slice of the future, keyed by an explicit slot the spec passes
 * (use distinct slots per test within a spec file).
 */
function windowFor(slot: number, durationDays: number): { pickup: Date; ret: Date } {
  const pickup = new Date();
  pickup.setDate(pickup.getDate() + 30 + slot * 7); // far from seeded bookings
  pickup.setHours(10, 0, 0, 0);
  const ret = new Date(pickup);
  ret.setDate(ret.getDate() + durationDays);
  return { pickup, ret };
}

export type FactoryBooking = { bookingId: string; reference: string; vehicleId: string | null };

/**
 * Create + stub-confirm a booking owned by the caller of `api` (use
 * customerApi → sarah). Returns ids once the booking is CONFIRMED with a
 * vehicle allocated.
 */
export async function createConfirmedBooking(
  api: Api,
  opts: { slot: number; durationDays?: number },
): Promise<FactoryBooking> {
  // Sarah (the customer storage-state user) is licence class C; her LAMS
  // eligibility rides on the seeded passport. Other suite traffic against
  // the shared user can clear it (updateProfile treats "" as removal) —
  // reassert the seeded identity so factories are order-independent.
  const sarah = await e2ePrisma.user.findUnique({
    where: { email: "sarah.smith@example.com" },
    select: { customerProfile: { select: { id: true, passportNumber: true } } },
  });
  if (sarah?.customerProfile && !sarah.customerProfile.passportNumber) {
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 2);
    await e2ePrisma.customerProfile.update({
      where: { id: sarah.customerProfile.id },
      data: { passportNumber: "PA1000000", passportCountry: "AU", passportExpiry: expiry },
    });
  }
  const { depotId, categoryId } = await refData();
  const { pickup, ret } = windowFor(opts.slot, opts.durationDays ?? 3);
  const created = await api.booking.create.mutate({
    categoryId,
    pickupDepotId: depotId,
    returnDepotId: depotId,
    pickupDateTime: pickup,
    returnDateTime: ret,
    agreedToTerms: true,
  });
  expect(created.booking.id).toBeTruthy();
  await api.booking.confirmPayment.mutate({
    bookingId: created.booking.id,
    paymentIntentId: created.paymentIntentId ?? undefined,
    bondPaymentIntentId: created.bondIntentId ?? undefined,
  });
  const row = await e2ePrisma.booking.findUniqueOrThrow({
    where: { id: created.booking.id },
    select: { status: true, vehicleId: true, bookingReference: true },
  });
  expect(row.status).toBe("CONFIRMED");
  return {
    bookingId: created.booking.id,
    reference: row.bookingReference,
    vehicleId: row.vehicleId,
  };
}

/** Booking left PENDING_PAYMENT (balance due) — feeds /dashboard/pay. */
export async function createPendingPaymentBooking(
  api: Api,
  opts: { slot: number; durationDays?: number },
): Promise<FactoryBooking> {
  const { depotId, categoryId } = await refData();
  const { pickup, ret } = windowFor(opts.slot, opts.durationDays ?? 2);
  const created = await api.booking.create.mutate({
    categoryId,
    pickupDepotId: depotId,
    returnDepotId: depotId,
    pickupDateTime: pickup,
    returnDateTime: ret,
    agreedToTerms: true,
  });
  return {
    bookingId: created.booking.id,
    reference: created.booking.bookingReference,
    vehicleId: null,
  };
}

/**
 * Run the staff pre-hire inspection via the real procedures so the check-out
 * wizard's step 1 shows Done (mirrors the seed's QA-CONFIRMED setup).
 */
export async function completePreHireInspection(
  staffApi: Api,
  booking: { bookingId: string; vehicleId: string | null },
): Promise<void> {
  if (!booking.vehicleId) throw new Error("factory: booking has no allocated vehicle");
  const vehicle = await e2ePrisma.vehicle.findUniqueOrThrow({
    where: { id: booking.vehicleId },
    select: { depotId: true, currentOdometerKm: true },
  });
  await staffApi.inspection.create.mutate({
    bookingId: booking.bookingId,
    vehicleId: booking.vehicleId,
    type: "PRE_HIRE",
    depotId: vehicle.depotId,
    odometerKm: vehicle.currentOdometerKm ?? 1_000,
    fuelLevel: 100,
    overallCondition: "GOOD",
    status: "COMPLETED",
  });
}
