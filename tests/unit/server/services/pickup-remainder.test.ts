import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * chargePickupRemainder — the check-out auto-charge for the pay-at-pickup
 * slice of balanceDue.
 *
 *   - charges exactly balanceDue − Σ(PENDING rows) and flips
 *     amountPaid/balanceDue transactionally
 *   - idempotent: an already-SUCCEEDED PICKUP-REM row → not_required
 *   - PENDING ancillary rows are excluded (the capture sweep owns them)
 *   - zero remainder → no charge, and a stale PENDING remainder row is
 *     superseded so it can't read as still-owed
 *   - decline → failed outcome, row kept PENDING with the decline noted
 *   - no saved card → no_pm
 */

const bookingFindUniqueOrThrow = vi.fn();
const bookingUpdate = vi.fn().mockResolvedValue({});
const paymentFindUnique = vi.fn();
const paymentAggregate = vi.fn();
const paymentCreate = vi.fn();
const paymentUpdate = vi.fn().mockResolvedValue({});
const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const paymentEventCreate = vi.fn().mockResolvedValue({});
const auditCreate = vi.fn().mockResolvedValue({});
const chargeOffSessionForUser = vi.fn();

const tx = {
  payment: { updateMany: paymentUpdateMany },
  booking: {
    findUniqueOrThrow: vi.fn().mockResolvedValue({ balanceDue: 90, amountPaid: 60 }),
    update: bookingUpdate,
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/services/stripe-customer", () => ({
  chargeOffSessionForUser: (...a: unknown[]) => chargeOffSessionForUser(...a),
}));

const prisma = {
  booking: { findUniqueOrThrow: bookingFindUniqueOrThrow, update: bookingUpdate },
  payment: {
    findUnique: paymentFindUnique,
    aggregate: paymentAggregate,
    create: paymentCreate,
    update: paymentUpdate,
  },
  paymentEvent: { create: paymentEventCreate },
  auditLog: { create: auditCreate },
  $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
} as never;

const baseBooking = {
  id: "b1",
  bookingReference: "SCT-0001",
  customerId: "cust_1",
  balanceDue: "90.00",
  amountPaid: "60.00",
  totalAmount: "150.00",
  gstAmount: "13.64",
};

beforeEach(() => {
  vi.clearAllMocks();
  bookingFindUniqueOrThrow.mockResolvedValue(baseBooking);
  paymentFindUnique.mockResolvedValue(null);
  paymentAggregate.mockResolvedValue({ _sum: { amount: null } });
  paymentCreate.mockResolvedValue({ id: "pay_rem", status: "PENDING", amount: 90 });
  paymentUpdateMany.mockResolvedValue({ count: 1 });
  tx.booking.findUniqueOrThrow.mockResolvedValue({ balanceDue: 90, amountPaid: 60 });
});

describe("chargePickupRemainder", () => {
  it("charges the remainder off-session and flips the booking counters", async () => {
    chargeOffSessionForUser.mockResolvedValue({
      id: "pi_rem",
      status: "succeeded",
      chargeId: "ch_rem",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    });
    const { chargePickupRemainder } = await import("@/server/services/pickup-remainder");
    const r = await chargePickupRemainder(prisma, { bookingId: "b1", staffUserId: "staff_1" });
    expect(r).toEqual({ outcome: "charged", paymentId: "pay_rem", amount: 90 });
    expect(chargeOffSessionForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "cust_1",
        amount: 90,
        idempotencyKey: "pickup-remainder:pay_rem:9000",
      }),
    );
    expect(bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { balanceDue: 0, amountPaid: 150 },
      }),
    );
  });

  it("excludes PENDING ancillary rows (they belong to the capture sweep)", async () => {
    paymentAggregate.mockResolvedValue({ _sum: { amount: 30 } }); // e.g. a raised addon
    paymentCreate.mockResolvedValue({ id: "pay_rem", status: "PENDING", amount: 60 });
    chargeOffSessionForUser.mockResolvedValue({
      id: "pi_rem",
      status: "succeeded",
      chargeId: "ch_rem",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    });
    const { chargePickupRemainder } = await import("@/server/services/pickup-remainder");
    const r = await chargePickupRemainder(prisma, { bookingId: "b1", staffUserId: "staff_1" });
    expect(r).toMatchObject({ outcome: "charged", amount: 60 });
    expect(chargeOffSessionForUser).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 60 }),
    );
  });

  it("is idempotent — an already-SUCCEEDED remainder row short-circuits", async () => {
    paymentFindUnique.mockResolvedValue({ id: "pay_rem", status: "SUCCEEDED", amount: 90 });
    const { chargePickupRemainder } = await import("@/server/services/pickup-remainder");
    const r = await chargePickupRemainder(prisma, { bookingId: "b1", staffUserId: "staff_1" });
    expect(r).toEqual({ outcome: "not_required" });
    expect(chargeOffSessionForUser).not.toHaveBeenCalled();
  });

  it("returns not_required on a zero balance and supersedes a stale PENDING row", async () => {
    bookingFindUniqueOrThrow.mockResolvedValue({ ...baseBooking, balanceDue: "0" });
    paymentFindUnique.mockResolvedValue({ id: "pay_stale", status: "PENDING", amount: 90 });
    const { chargePickupRemainder } = await import("@/server/services/pickup-remainder");
    const r = await chargePickupRemainder(prisma, { bookingId: "b1", staffUserId: "staff_1" });
    expect(r).toEqual({ outcome: "not_required" });
    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay_stale" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  it("blocks with `failed` on a decline, keeping the row PENDING for retry", async () => {
    chargeOffSessionForUser.mockResolvedValue({
      id: "pi_declined",
      status: "requires_payment_method",
      errorCode: "card_declined",
      errorMessage: "Your card was declined.",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    });
    const { chargePickupRemainder } = await import("@/server/services/pickup-remainder");
    const r = await chargePickupRemainder(prisma, { bookingId: "b1", staffUserId: "staff_1" });
    expect(r).toMatchObject({ outcome: "failed", amount: 90, errorCode: "card_declined" });
    // Status untouched (still PENDING) — only the PI id + note recorded.
    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ status: expect.anything() }),
      }),
    );
    expect(bookingUpdate).not.toHaveBeenCalled();
  });

  it("returns no_pm when the customer has no saved card", async () => {
    chargeOffSessionForUser.mockResolvedValue(null);
    const { chargePickupRemainder } = await import("@/server/services/pickup-remainder");
    const r = await chargePickupRemainder(prisma, { bookingId: "b1", staffUserId: "staff_1" });
    expect(r).toEqual({ outcome: "no_pm", amount: 90 });
    expect(bookingUpdate).not.toHaveBeenCalled();
  });
});
