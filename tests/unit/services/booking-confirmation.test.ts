import { describe, expect, it, vi, beforeEach } from "vitest";

// External side-effects are stubbed — the test exercises the confirm /
// allocate / idempotency state machine, not Stripe or email rendering.
const retrievePaymentIntentMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  retrievePaymentIntent: (...a: unknown[]) => retrievePaymentIntentMock(...a),
}));
const sendNotificationMock = vi.fn();
vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: (...a: unknown[]) => sendNotificationMock(...a),
}));
vi.mock("@/server/services/audit", () => ({
  writeAudit: vi.fn(),
  writeCustomerAuditAsync: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ trackServer: vi.fn() }));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({ siteName: "X" }),
}));
vi.mock("@react-email/render", () => ({
  render: vi.fn().mockResolvedValue("<html></html>"),
}));
vi.mock("@/server/services/invoice-lifecycle", () => ({
  issueInvoiceForBooking: vi.fn(),
  issueReceiptForPayment: vi.fn(),
}));
const enqueueNotifyMock = vi.fn();
vi.mock("@/server/jobs/booking-confirmation-notify", () => ({
  enqueueBookingConfirmationNotify: (...a: unknown[]) => enqueueNotifyMock(...a),
}));
const allocateVehicleMock = vi.fn();
const isVehicleFreeMock = vi.fn();
vi.mock("@/server/services/availability", () => ({
  acquireAllocationLock: vi.fn(),
  allocateVehicle: (...a: unknown[]) => allocateVehicleMock(...a),
  isVehicleFree: (...a: unknown[]) => isVehicleFreeMock(...a),
}));

import {
  confirmBookingPayment,
  sendBookingConfirmationNotification,
  PaymentNotSucceededError,
  BondNotHeldError,
  BookingNotConfirmableError,
} from "../../../src/server/services/booking-confirmation";

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    bookingReference: "XPM-20260610-0001",
    status: "PENDING_PAYMENT",
    customerId: "cust1",
    categoryId: "cat1",
    pickupDepotId: "depot1",
    pickupDateTime: new Date("2026-06-20T09:00:00Z"),
    returnDateTime: new Date("2026-06-22T09:00:00Z"),
    durationDays: 2,
    payOnlineAmount: 100,
    totalAmount: 150,
    gstAmount: 13.64,
    bondAmount: 50,
    amountPaid: 0,
    balanceDue: 150,
    source: "WEBSITE",
    pricingSnapshot: {},
    category: { name: "Scooter", slug: "scooter" },
    pickupDepot: {
      name: "Brisbane",
      slug: "brisbane",
      addressLine1: "1 Test St",
      addressLine2: null,
      suburb: "Brisbane",
      state: "QLD",
      postcode: "4000",
    },
    customer: { firstName: "Vlad" },
    ...overrides,
  };
}

function makeMockPrisma(booking: Record<string, unknown>, opts: {
  txStatus?: string;
  existingDeposit?: { id: string } | null;
} = {}) {
  const tx = {
    booking: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ status: opts.txStatus ?? booking.status }),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...booking,
        ...data,
      })),
    },
    vehicle: { findUnique: vi.fn().mockResolvedValue(null) },
    payment: {
      findFirst: vi.fn().mockResolvedValue(opts.existingDeposit ?? null),
    },
    bondLedger: { upsert: vi.fn() },
    bookingBillingPlan: { upsert: vi.fn() },
  };
  const prisma = {
    booking: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(booking),
      count: vi.fn().mockResolvedValue(1),
    },
    payment: { findFirst: vi.fn().mockResolvedValue({ id: "pay1" }) },
    invoice: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  return { prisma: prisma as never, tx, top: prisma };
}

beforeEach(() => {
  vi.clearAllMocks();
  retrievePaymentIntentMock.mockResolvedValue(null);
  allocateVehicleMock.mockResolvedValue("veh1");
  isVehicleFreeMock.mockResolvedValue(true);
});

describe("confirmBookingPayment — happy path", () => {
  it("allocates a vehicle, flips to CONFIRMED, records the deposit and notifies", async () => {
    const { prisma, tx } = makeMockPrisma(makeBooking());

    const res = await confirmBookingPayment(prisma, {
      bookingId: "b1",
      paymentIntentId: "pi_1",
      bondPaymentIntentId: "pi_bond_1",
      actorUserId: "cust1",
      source: "checkout",
    });

    expect(res.alreadyConfirmed).toBe(false);
    const update = tx.booking.update.mock.calls[0]![0]!;
    expect(update.data.status).toBe("CONFIRMED");
    expect(update.data.vehicleId).toBe("veh1");
    expect(update.data.amountPaid).toBe(100);
    expect(update.data.balanceDue).toBe(50);
    expect(update.data.payments.create.amount).toBe(100);
    expect(update.data.payments.create.stripePaymentIntentId).toBe("pi_1");
    expect(tx.bondLedger.upsert).toHaveBeenCalled();
    // The send itself is queued (booking-confirmation-notify), not inline.
    expect(enqueueNotifyMock).toHaveBeenCalledWith("b1");
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});

describe("confirmBookingPayment — idempotency", () => {
  it("no-ops when the booking is already CONFIRMED (client retry / webhook redelivery)", async () => {
    const { prisma, top } = makeMockPrisma(makeBooking({ status: "CONFIRMED" }));

    const res = await confirmBookingPayment(prisma, {
      bookingId: "b1",
      source: "stripe-webhook",
    });

    expect(res.alreadyConfirmed).toBe(true);
    expect(top.$transaction).not.toHaveBeenCalled();
    expect(enqueueNotifyMock).not.toHaveBeenCalled();
  });

  it("no-ops when a concurrent confirm flipped the status while waiting on the lock", async () => {
    const { prisma, tx } = makeMockPrisma(makeBooking(), { txStatus: "CONFIRMED" });

    const res = await confirmBookingPayment(prisma, {
      bookingId: "b1",
      source: "stripe-webhook",
    });

    expect(res.alreadyConfirmed).toBe(true);
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(enqueueNotifyMock).not.toHaveBeenCalled();
  });

  it("does not duplicate the deposit Payment row or clobber money fields when one already exists", async () => {
    const { prisma, tx } = makeMockPrisma(makeBooking(), {
      existingDeposit: { id: "pay_existing" },
    });

    await confirmBookingPayment(prisma, {
      bookingId: "b1",
      paymentIntentId: "pi_1",
      source: "ttl-sweep",
    });

    const update = tx.booking.update.mock.calls[0]![0]!;
    expect(update.data.status).toBe("CONFIRMED");
    expect(update.data.payments).toBeUndefined();
    expect(update.data.amountPaid).toBeUndefined();
    expect(update.data.balanceDue).toBeUndefined();
  });
});

describe("confirmBookingPayment — guards", () => {
  it("rejects when the PaymentIntent has not succeeded", async () => {
    retrievePaymentIntentMock.mockResolvedValue({ status: "requires_payment_method" });
    const { prisma } = makeMockPrisma(makeBooking());

    await expect(
      confirmBookingPayment(prisma, {
        bookingId: "b1",
        paymentIntentId: "pi_1",
        source: "checkout",
      }),
    ).rejects.toBeInstanceOf(PaymentNotSucceededError);
  });

  it("rejects when the bond authorisation is not held", async () => {
    retrievePaymentIntentMock
      .mockResolvedValueOnce({ status: "succeeded" })
      .mockResolvedValueOnce({ status: "canceled" });
    const { prisma } = makeMockPrisma(makeBooking());

    await expect(
      confirmBookingPayment(prisma, {
        bookingId: "b1",
        paymentIntentId: "pi_1",
        bondPaymentIntentId: "pi_bond_1",
        source: "checkout",
      }),
    ).rejects.toBeInstanceOf(BondNotHeldError);
  });

  it("rejects a CANCELLED booking as not confirmable", async () => {
    const { prisma, top } = makeMockPrisma(makeBooking({ status: "CANCELLED" }));

    await expect(
      confirmBookingPayment(prisma, { bookingId: "b1", source: "stripe-webhook" }),
    ).rejects.toBeInstanceOf(BookingNotConfirmableError);
    expect(top.$transaction).not.toHaveBeenCalled();
  });
});

describe("sendBookingConfirmationNotification (queue processor)", () => {
  function makeNotifyPrisma(booking: Record<string, unknown> | null) {
    return {
      booking: { findUnique: vi.fn().mockResolvedValue(booking) },
      invoice: { findFirst: vi.fn().mockResolvedValue({ id: "inv1" }) },
      payment: { findFirst: vi.fn().mockResolvedValue({ id: "pay1" }) },
    } as never;
  }

  it("sends the confirmation with invoice + receipt attachments", async () => {
    const prisma = makeNotifyPrisma(makeBooking({ status: "CONFIRMED" }));

    await sendBookingConfirmationNotification(prisma, "b1");

    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "cust1",
        type: "BOOKING_CONFIRMATION",
        bookingId: "b1",
        attachments: [
          { kind: "invoice", invoiceId: "inv1" },
          { kind: "receipt", paymentId: "pay1" },
        ],
      }),
    );
  });

  it("skips quietly when the booking no longer exists (stale retry)", async () => {
    const prisma = makeNotifyPrisma(null);

    await sendBookingConfirmationNotification(prisma, "gone");

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});
