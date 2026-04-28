import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma. Each test configures the `booking.findUniqueOrThrow` return
// value and inspects the side-effect calls captured below.
const bookingUpdateMany = vi.fn();
const bookingFindUniqueOrThrow = vi.fn();
const bookingUpdate = vi.fn();
const bondLedgerUpdate = vi.fn();
const paymentCreate = vi.fn();
const bookingStatusLogCreate = vi.fn();
const vehicleUpdate = vi.fn();
const auditLogCreate = vi.fn();
const billingPlanUpdate = vi.fn();
const transaction = vi.fn();

const stripeCancel = vi.fn();
const stripeRefund = vi.fn();
const sendNotification = vi.fn();
const invalidateRevenueCaches = vi.fn();
const supersedeByTarget = vi.fn();
const renderEmail = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUniqueOrThrow: bookingFindUniqueOrThrow,
      updateMany: bookingUpdateMany,
      update: bookingUpdate,
    },
    vehicle: { update: vehicleUpdate },
    auditLog: { create: auditLogCreate },
    $transaction: transaction,
  },
}));

vi.mock("@/lib/stripe", () => ({
  cancelPaymentIntent: stripeCancel,
  refundCharge: stripeRefund,
}));

vi.mock("@/server/services/notification-sender", () => ({
  sendNotification,
}));

vi.mock("@/server/services/revenue-aggregator", () => ({
  invalidateRevenueCaches,
}));

vi.mock("@/server/services/staff-tasks", () => ({
  supersedeByTarget,
}));

vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({
    siteName: "Test Rentals",
    legalName: "Test Pty Ltd",
    abn: "00 000 000 000",
  }),
}));

vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  SETTING_DEFAULTS: {},
}));

vi.mock("@react-email/render", () => ({ render: renderEmail }));

type BookingFixture = {
  id: string;
  customerId: string;
  depotId: string;
  vehicleId: string | null;
  bookingReference: string;
  status: string;
  amountPaid: number;
  pickupDateTime: Date;
  subscriptionId: string | null;
  extensionOfId: string | null;
  customer: { id: string; firstName: string };
  bondLedger: {
    bookingId: string;
    status: string;
    heldAmount: number;
    capturedAmount: number;
    stripePaymentIntentId: string;
  } | null;
  payments: Array<{
    id: string;
    stripePaymentIntentId: string | null;
    stripeChargeId: string | null;
  }>;
  extensions: Array<{ id: string; status: string }>;
};

// Per-test override for what `tx.bookingBillingPlan.findUnique` returns
// inside the cancellation transaction. Default is null (no plan).
let billingPlanLookup: { status: string } | null = null;
function setBillingPlan(plan: { status: string } | null) {
  billingPlanLookup = plan;
}

const BASE_BOOKING: BookingFixture = {
  id: "b1",
  customerId: "u1",
  depotId: "d1",
  vehicleId: "v1",
  bookingReference: "SCT-1",
  status: "CONFIRMED",
  amountPaid: 300,
  pickupDateTime: new Date(Date.now() + 96 * 3_600_000), // 96h = full refund
  subscriptionId: null,
  extensionOfId: null,
  customer: { id: "u1", firstName: "Alex" },
  bondLedger: null,
  payments: [],
  extensions: [],
};

function setBooking(overrides: Partial<BookingFixture> = {}) {
  bookingFindUniqueOrThrow.mockResolvedValue({ ...BASE_BOOKING, ...overrides });
}

function txStubCaptures() {
  const calls: { table: string; op: string; args: unknown }[] = [];
  const tx = {
    booking: {
      updateMany: vi.fn(async (args: unknown) => {
        calls.push({ table: "booking", op: "updateMany", args });
        return { count: 1 };
      }),
      update: vi.fn(async (args: unknown) => {
        calls.push({ table: "booking", op: "update", args });
        return {};
      }),
    },
    bookingStatusLog: {
      create: vi.fn(async (args: unknown) => {
        calls.push({ table: "bookingStatusLog", op: "create", args });
        bookingStatusLogCreate(args);
      }),
    },
    bondLedger: {
      update: vi.fn(async (args: unknown) => {
        calls.push({ table: "bondLedger", op: "update", args });
        bondLedgerUpdate(args);
      }),
    },
    payment: {
      create: vi.fn(async (args: unknown) => {
        calls.push({ table: "payment", op: "create", args });
        paymentCreate(args);
      }),
    },
    bookingBillingPlan: {
      findUnique: vi.fn(async (args: unknown) => {
        calls.push({ table: "bookingBillingPlan", op: "findUnique", args });
        return billingPlanLookup;
      }),
      update: vi.fn(async (args: unknown) => {
        calls.push({ table: "bookingBillingPlan", op: "update", args });
        billingPlanUpdate(args);
      }),
    },
  };
  return { tx, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  stripeRefund.mockReset();
  stripeRefund.mockResolvedValue({ id: "re_test_1", status: "succeeded" });
  stripeCancel.mockReset();
  stripeCancel.mockResolvedValue(true);
  renderEmail.mockResolvedValue("<html/>");
  sendNotification.mockResolvedValue({ results: [], logIds: [], notificationIds: [] });
  invalidateRevenueCaches.mockResolvedValue(undefined);
  supersedeByTarget.mockResolvedValue(undefined);
  billingPlanLookup = null;
});

describe("cancel — refund tiers", () => {
  it("issues full refund less admin fee when >72h before pickup", async () => {
    setBooking({
      amountPaid: 300,
      pickupDateTime: new Date(Date.now() + 96 * 3_600_000),
      payments: [{ id: "p1", stripePaymentIntentId: "pi_1", stripeChargeId: "ch_1" }],
    });
    const { tx, calls } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    const result = await cancel({
      bookingId: "b1",
      reason: "Changed plans",
      source: "CUSTOMER",
      actorUserId: "u1",
    });

    expect(result.refundAmount).toBe(275); // 300 - 25
    expect(result.refundPct).toBe(1);
    expect(stripeRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 27500,
        idempotencyKey: "refund-b1-p1",
      }),
    );
    const refundRow = calls.find((c) => c.table === "payment");
    expect(refundRow).toBeDefined();
    expect((refundRow!.args as { data: { amount: number; status: string } }).data).toMatchObject({
      amount: 275,
      status: "SUCCEEDED",
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0]?.[0]).toMatchObject({
      type: "BOOKING_CANCELLED",
      dedupKey: "booking-cancelled:b1",
    });
  });

  it("issues 50% refund less admin fee between 24 and 72h", async () => {
    setBooking({
      amountPaid: 400,
      pickupDateTime: new Date(Date.now() + 48 * 3_600_000),
      payments: [{ id: "p1", stripePaymentIntentId: "pi_1", stripeChargeId: "ch_1" }],
    });
    const { tx } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    const r = await cancel({
      bookingId: "b1",
      reason: "Weather",
      source: "CUSTOMER",
      actorUserId: "u1",
    });

    expect(r.refundPct).toBe(0.5);
    expect(r.refundAmount).toBe(175); // 200 - 25
  });

  it("no refund when <24h before pickup", async () => {
    setBooking({
      amountPaid: 300,
      pickupDateTime: new Date(Date.now() + 2 * 3_600_000),
      payments: [{ id: "p1", stripePaymentIntentId: "pi_1", stripeChargeId: "ch_1" }],
    });
    const { tx } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    const r = await cancel({
      bookingId: "b1",
      reason: "Changed plans",
      source: "CUSTOMER",
      actorUserId: "u1",
    });

    expect(r.refundPct).toBe(0);
    expect(r.refundAmount).toBe(0);
    expect(stripeRefund).not.toHaveBeenCalled();
  });
});

describe("cancel — bond release", () => {
  it("releases the full held amount when bond status is HELD", async () => {
    setBooking({
      amountPaid: 300,
      bondLedger: {
        bookingId: "b1",
        status: "HELD",
        heldAmount: 500,
        capturedAmount: 0,
        stripePaymentIntentId: "pi_bond",
      },
      payments: [{ id: "p1", stripePaymentIntentId: "pi_1", stripeChargeId: "ch_1" }],
    });
    const { tx } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    const r = await cancel({
      bookingId: "b1",
      reason: "x",
      source: "CUSTOMER",
      actorUserId: "u1",
    });

    expect(r.bondReleasedAmount).toBe(500);
    expect(stripeCancel).toHaveBeenCalledWith("pi_bond");
    expect(bondLedgerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RELEASED", releasedAmount: 500 }),
      }),
    );
  });

  it("only releases the remainder when bond is PARTIALLY_CAPTURED", async () => {
    setBooking({
      amountPaid: 300,
      bondLedger: {
        bookingId: "b1",
        status: "HELD",
        heldAmount: 500,
        capturedAmount: 120,
        stripePaymentIntentId: "pi_bond",
      },
      payments: [],
    });
    const { tx } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    const r = await cancel({
      bookingId: "b1",
      reason: "x",
      source: "CUSTOMER",
      actorUserId: "u1",
    });

    expect(r.bondReleasedAmount).toBe(380);
    expect(bondLedgerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ releasedAmount: 380 }),
      }),
    );
  });

  it("does not release a FULLY_CAPTURED bond", async () => {
    setBooking({
      amountPaid: 300,
      bondLedger: {
        bookingId: "b1",
        status: "FULLY_CAPTURED",
        heldAmount: 500,
        capturedAmount: 500,
        stripePaymentIntentId: "pi_bond",
      },
      payments: [],
    });
    const { tx } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    const r = await cancel({
      bookingId: "b1",
      reason: "x",
      source: "CUSTOMER",
      actorUserId: "u1",
    });

    expect(r.bondReleasedAmount).toBe(0);
    expect(stripeCancel).not.toHaveBeenCalled();
    expect(bondLedgerUpdate).not.toHaveBeenCalled();
  });
});

describe("cancel — eligibility gating", () => {
  it("blocks CHECKED_OUT", async () => {
    setBooking({ status: "CHECKED_OUT" });
    const { cancel } = await import("@/server/services/booking-cancellation");
    await expect(
      cancel({ bookingId: "b1", reason: "x", source: "CUSTOMER", actorUserId: "u1" }),
    ).rejects.toThrow(/already collected the vehicle/i);
  });

  it("blocks DISPUTED", async () => {
    setBooking({ status: "DISPUTED" });
    const { cancel } = await import("@/server/services/booking-cancellation");
    await expect(
      cancel({ bookingId: "b1", reason: "x", source: "CUSTOMER", actorUserId: "u1" }),
    ).rejects.toThrow(/in dispute/i);
  });

  it("blocks extension children", async () => {
    setBooking({ extensionOfId: "parent-1" });
    const { cancel } = await import("@/server/services/booking-cancellation");
    await expect(
      cancel({ bookingId: "b1", reason: "x", source: "CUSTOMER", actorUserId: "u1" }),
    ).rejects.toThrow(/extension attached to a parent booking/i);
  });

  it("blocks subscription parents for customers", async () => {
    setBooking({ subscriptionId: "sub-1" });
    const { cancel } = await import("@/server/services/booking-cancellation");
    await expect(
      cancel({ bookingId: "b1", reason: "x", source: "CUSTOMER", actorUserId: "u1" }),
    ).rejects.toThrow(/part of an active subscription/i);
  });

  it("allows subscription parents when staff passes allowSubscriptionOverride", async () => {
    setBooking({ subscriptionId: "sub-1", payments: [] });
    const { tx } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    await expect(
      cancel({
        bookingId: "b1",
        reason: "x",
        source: "STAFF",
        actorUserId: "staff-1",
        allowSubscriptionOverride: true,
      }),
    ).resolves.toMatchObject({ refundAmount: expect.any(Number) });
  });
});

describe("cancel — Stripe failure", () => {
  it("still cancels the booking when Stripe refund throws; Payment row FAILED", async () => {
    setBooking({
      amountPaid: 300,
      pickupDateTime: new Date(Date.now() + 96 * 3_600_000),
      payments: [{ id: "p1", stripePaymentIntentId: "pi_1", stripeChargeId: "ch_1" }],
    });
    stripeRefund.mockRejectedValueOnce(new Error("card_declined"));
    const { tx, calls } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    const r = await cancel({
      bookingId: "b1",
      reason: "x",
      source: "CUSTOMER",
      actorUserId: "u1",
    });

    expect(r.refundStatus).toBe("FAILED");
    const refundRow = calls.find((c) => c.table === "payment");
    expect((refundRow!.args as { data: { status: string; notes: string } }).data).toMatchObject({
      status: "FAILED",
      notes: expect.stringContaining("card_declined"),
    });
  });
});

describe("cancel — cascade to extension children", () => {
  it("cancels non-terminal children in the same transaction", async () => {
    setBooking({
      amountPaid: 100,
      extensions: [
        { id: "c1", status: "CONFIRMED" },
        { id: "c2", status: "COMPLETED" }, // terminal — should be skipped
        { id: "c3", status: "CANCELLED" }, // already cancelled — should be skipped
      ],
      payments: [{ id: "p1", stripePaymentIntentId: "pi_1", stripeChargeId: "ch_1" }],
    });
    const { tx, calls } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    const r = await cancel({
      bookingId: "b1",
      reason: "x",
      source: "CUSTOMER",
      actorUserId: "u1",
    });

    expect(r.cascadedBookingIds).toEqual(["c1"]);
    const childUpdate = calls.find(
      (c) =>
        c.table === "booking" &&
        c.op === "update" &&
        (c.args as { where: { id: string } }).where.id === "c1",
    );
    expect(childUpdate).toBeDefined();
  });
});

describe("cancel — concurrency guard", () => {
  it("throws CONFLICT when another path moved the booking out of a cancellable state", async () => {
    setBooking({ payments: [] });
    const tx = {
      booking: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn(),
      },
      bookingStatusLog: { create: vi.fn() },
      bondLedger: { update: vi.fn() },
      payment: { create: vi.fn() },
      bookingBillingPlan: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    await expect(
      cancel({ bookingId: "b1", reason: "x", source: "CUSTOMER", actorUserId: "u1" }),
    ).rejects.toThrow(/no longer in a cancellable state/);
  });
});

describe("cancel — reconciliation side-effects", () => {
  it("zeroes balanceDue on the booking update", async () => {
    setBooking({ payments: [] });
    const { tx, calls } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    await cancel({ bookingId: "b1", reason: "x", source: "STAFF", actorUserId: "u1" });

    const updateCall = calls.find(
      (c) => c.table === "booking" && c.op === "updateMany",
    );
    expect(updateCall).toBeDefined();
    expect(
      (updateCall!.args as { data: { balanceDue: number } }).data.balanceDue,
    ).toBe(0);
  });

  it("cancels an active BookingBillingPlan with a reason", async () => {
    setBooking({ payments: [] });
    setBillingPlan({ status: "ACTIVE" });
    const { tx } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    await cancel({
      bookingId: "b1",
      reason: "Customer request",
      source: "CUSTOMER",
      actorUserId: "u1",
    });

    expect(billingPlanUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "b1" },
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelReason: expect.stringContaining("Customer request"),
        }),
      }),
    );
  });

  it("cancels a paused BookingBillingPlan", async () => {
    setBooking({ payments: [] });
    setBillingPlan({ status: "PAUSED" });
    const { tx } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    await cancel({ bookingId: "b1", reason: "x", source: "STAFF", actorUserId: "u1" });

    expect(billingPlanUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not touch a plan that is already CANCELLED or COMPLETED", async () => {
    for (const status of ["CANCELLED", "COMPLETED"]) {
      vi.clearAllMocks();
      setBooking({ payments: [] });
      setBillingPlan({ status });
      const { tx } = txStubCaptures();
      transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

      const { cancel } = await import("@/server/services/booking-cancellation");
      await cancel({ bookingId: "b1", reason: "x", source: "STAFF", actorUserId: "u1" });

      expect(billingPlanUpdate).not.toHaveBeenCalled();
    }
  });

  it("does not error when the booking has no billing plan", async () => {
    setBooking({ payments: [] });
    setBillingPlan(null);
    const { tx } = txStubCaptures();
    transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const { cancel } = await import("@/server/services/booking-cancellation");
    await expect(
      cancel({ bookingId: "b1", reason: "x", source: "STAFF", actorUserId: "u1" }),
    ).resolves.toBeDefined();
    expect(billingPlanUpdate).not.toHaveBeenCalled();
  });
});

describe("quoteCancellation", () => {
  beforeEach(() => {
    // quoteCancellation uses a different finder — reset and stub.
    bookingFindUniqueOrThrow.mockReset();
  });

  it("reports FULL tier at 96h", async () => {
    bookingFindUniqueOrThrow.mockResolvedValue({
      status: "CONFIRMED",
      pickupDateTime: new Date(Date.now() + 96 * 3_600_000),
      amountPaid: 300,
      subscriptionId: null,
      extensionOfId: null,
      bondLedger: null,
    });
    const { quoteCancellation } = await import("@/server/services/booking-cancellation");
    const q = await quoteCancellation("b1");
    expect(q.eligible).toBe(true);
    expect(q.refundTier).toBe("FULL");
    expect(q.refundAmount).toBe(275);
    expect(q.adminFee).toBe(25);
  });

  it("reports NONE tier with no side effects", async () => {
    bookingFindUniqueOrThrow.mockResolvedValue({
      status: "CONFIRMED",
      pickupDateTime: new Date(Date.now() + 2 * 3_600_000),
      amountPaid: 300,
      subscriptionId: null,
      extensionOfId: null,
      bondLedger: null,
    });
    const { quoteCancellation } = await import("@/server/services/booking-cancellation");
    const q = await quoteCancellation("b1");
    expect(q.refundTier).toBe("NONE");
    expect(q.refundAmount).toBe(0);
    expect(stripeRefund).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("reports SUBSCRIPTION_PARENT ineligibility", async () => {
    bookingFindUniqueOrThrow.mockResolvedValue({
      status: "CONFIRMED",
      pickupDateTime: new Date(Date.now() + 96 * 3_600_000),
      amountPaid: 300,
      subscriptionId: "sub-1",
      extensionOfId: null,
      bondLedger: null,
    });
    const { quoteCancellation } = await import("@/server/services/booking-cancellation");
    const q = await quoteCancellation("b1");
    expect(q.eligible).toBe(false);
    expect(q.ineligibleReason).toBe("SUBSCRIPTION_PARENT");
  });
});
