import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * closeOutQuotePendingCharges — a completed repair work order turns the
 * QUOTE_PENDING damage charge into a billable PENDING Payment capped at the
 * customer's acknowledged quoteCapAmount, and flips a quote-parked RETURNED
 * booking to COMPLETED (via recordBookingCompletion) once the last quote
 * resolves.
 */

const damageChargeFindMany = vi.fn();
const damageChargeCount = vi.fn();
const damageChargeUpdate = vi.fn().mockResolvedValue({});
const paymentCreate = vi.fn().mockResolvedValue({ id: "pay_dmg" });
const bookingUpdate = vi.fn().mockResolvedValue({});
const auditCreate = vi.fn().mockResolvedValue({});
const recordAdditionalCharges = vi.fn();
const recordBookingCompletion = vi.fn();
const sendNotification = vi.fn().mockResolvedValue({});

const tx = {
  payment: { create: paymentCreate },
  damageCharge: { update: damageChargeUpdate },
  booking: { update: bookingUpdate },
};

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
// The excess cap's DB readers are unit-tested in tests/unit/services/
// excess.test.ts — stub them here (generous headroom, nothing consumed) so
// this suite keeps exercising the close-out billing math; the pure
// applyExcessCap stays real.
vi.mock("@/server/services/excess", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBookingExcess: vi.fn(async () => ({
    excess: 3000,
    source: "SETTING",
    tierName: null,
  })),
  getDamageLiabilityUsed: vi.fn(async () => 0),
}));
vi.mock("@/server/services/revenue-aggregator", () => ({
  recordAdditionalCharges: (...a: unknown[]) => recordAdditionalCharges(...a),
  recordBookingCompletion: (...a: unknown[]) => recordBookingCompletion(...a),
}));
vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: (...a: unknown[]) => sendNotification(...a),
}));

const prisma = {
  damageCharge: {
    findMany: damageChargeFindMany,
    count: damageChargeCount,
    update: damageChargeUpdate,
  },
  payment: { create: paymentCreate },
  booking: { update: bookingUpdate },
  auditLog: { create: auditCreate },
  $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
} as never;

function makeCharge(over: Record<string, unknown> = {}) {
  return {
    id: "dc_1",
    description: "Cracked fairing",
    quoteCapAmount: "500.00",
    returnAssessment: {
      bookingId: "b1",
      booking: {
        id: "b1",
        bookingReference: "SCT-0001",
        customerId: "cust_1",
        depotId: "depot_1",
        status: "RETURNED",
        actualReturnDateTime: new Date("2026-07-01T00:00:00Z"),
        subtotal: "300",
        addonTotal: "0",
        gstAmount: "27.27",
        totalAmount: "300",
      },
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  paymentCreate.mockResolvedValue({ id: "pay_dmg" });
  damageChargeCount.mockResolvedValue(0);
});

describe("closeOutQuotePendingCharges", () => {
  it("bills min(actualCost, cap) as a PENDING DAMAGE_CHARGE + balanceDue raise", async () => {
    damageChargeFindMany.mockResolvedValue([makeCharge()]);
    const { closeOutQuotePendingCharges } = await import(
      "@/server/services/damage-quote-closeout"
    );
    const r = await closeOutQuotePendingCharges(prisma, {
      workOrderId: "wo_1",
      actualCost: 380,
      staffUserId: "staff_1",
    });
    expect(r.billed).toBe(1);
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reference: "DMG-dc_1",
          type: "DAMAGE_CHARGE",
          status: "PENDING",
          amount: 380,
          customerId: "cust_1",
        }),
      }),
    );
    expect(bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balanceDue: { increment: 380 } } }),
    );
    expect(recordAdditionalCharges).toHaveBeenCalled();
  });

  it("caps the bill at the customer's acknowledged quote cap", async () => {
    damageChargeFindMany.mockResolvedValue([makeCharge()]);
    const { closeOutQuotePendingCharges } = await import(
      "@/server/services/damage-quote-closeout"
    );
    await closeOutQuotePendingCharges(prisma, {
      workOrderId: "wo_1",
      actualCost: 900, // over the $500 cap
      staffUserId: "staff_1",
    });
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 500 }) }),
    );
  });

  it("flips a RETURNED booking to COMPLETED via recordBookingCompletion once the last quote resolves", async () => {
    damageChargeFindMany.mockResolvedValue([makeCharge()]);
    damageChargeCount.mockResolvedValue(0); // no remaining quotes
    const { closeOutQuotePendingCharges } = await import(
      "@/server/services/damage-quote-closeout"
    );
    const r = await closeOutQuotePendingCharges(prisma, {
      workOrderId: "wo_1",
      actualCost: 100,
      staffUserId: "staff_1",
    });
    expect(r.bookingCompleted).toBe(true);
    expect(bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
    // Booking-completion invariant — counters derive from this call.
    expect(recordBookingCompletion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "b1", customerId: "cust_1" }),
    );
  });

  it("keeps the booking RETURNED while other quotes remain open", async () => {
    damageChargeFindMany.mockResolvedValue([makeCharge()]);
    damageChargeCount.mockResolvedValue(1); // another quote still open
    const { closeOutQuotePendingCharges } = await import(
      "@/server/services/damage-quote-closeout"
    );
    const r = await closeOutQuotePendingCharges(prisma, {
      workOrderId: "wo_1",
      actualCost: 100,
      staffUserId: "staff_1",
    });
    expect(r.bookingCompleted).toBe(false);
    expect(recordBookingCompletion).not.toHaveBeenCalled();
  });

  it("resolves a zero-cost repair without billing", async () => {
    damageChargeFindMany.mockResolvedValue([makeCharge()]);
    const { closeOutQuotePendingCharges } = await import(
      "@/server/services/damage-quote-closeout"
    );
    const r = await closeOutQuotePendingCharges(prisma, {
      workOrderId: "wo_1",
      actualCost: 0,
      staffUserId: "staff_1",
    });
    expect(r.billed).toBe(0);
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(damageChargeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CONFIRMED", amount: 0 }),
      }),
    );
  });

  it("no-ops when the work order has no open quote charges", async () => {
    damageChargeFindMany.mockResolvedValue([]);
    const { closeOutQuotePendingCharges } = await import(
      "@/server/services/damage-quote-closeout"
    );
    const r = await closeOutQuotePendingCharges(prisma, {
      workOrderId: "wo_x",
      actualCost: 100,
      staffUserId: "staff_1",
    });
    expect(r).toEqual({ billed: 0, bookingCompleted: false });
  });
});
