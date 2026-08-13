import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Collaborator mocks ─────────────────────────────────────────────────────
const cancelPaymentIntentMock = vi.fn();
const refundChargeMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  cancelPaymentIntent: (...a: unknown[]) => cancelPaymentIntentMock(...a),
  refundCharge: (...a: unknown[]) => refundChargeMock(...a),
}));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({ siteName: "XPERT Moto" }),
}));
const sendNotificationMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: (...a: unknown[]) => sendNotificationMock(...a),
}));
const tryIssueAdjustmentMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/invoice-lifecycle", () => ({
  tryIssueAdjustmentForBooking: (...a: unknown[]) => tryIssueAdjustmentMock(...a),
}));
const recordBookingCompletionMock = vi.fn().mockResolvedValue(undefined);
const invalidateRevenueCachesMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/revenue-aggregator", () => ({
  recordBookingCompletion: (...a: unknown[]) => recordBookingCompletionMock(...a),
  invalidateRevenueCaches: (...a: unknown[]) => invalidateRevenueCachesMock(...a),
}));
const issueGiftCardMock = vi.fn();
const restoreGiftCardMock = vi.fn().mockResolvedValue({ restored: 0 });
vi.mock("@/server/services/gift-card", () => ({
  issueGiftCard: (...a: unknown[]) => issueGiftCardMock(...a),
  restoreGiftCardForBooking: (...a: unknown[]) => restoreGiftCardMock(...a),
}));
vi.mock("@/server/services/staff-tasks", () => ({
  autoCloseByTarget: vi.fn().mockResolvedValue(undefined),
}));
const enqueueRefundRetryMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/jobs/refund-retry", () => ({
  enqueueRefundRetry: (...a: unknown[]) => enqueueRefundRetryMock(...a),
}));
vi.mock("@react-email/render", () => ({
  render: vi.fn().mockResolvedValue("<html />"),
}));
vi.mock("../../../emails/booking-terminated", () => ({
  default: () => null,
}));

import {
  previewLossTermination,
  terminateBookingForLoss,
} from "@/server/services/booking-termination";

// ── Fixture ────────────────────────────────────────────────────────────────
// 7-day hire: subtotal 770, code discount 70 → discounted effective base
// rate (770 − 70) / 7 = 100/day. Per-day addon 5/day; one NON-per-day addon
// that must be excluded. Insurance 15/day. Per-day bundle = 120/day.
// Loss 3 days before scheduled return → 3 unused days → gross 360.
const PICKUP = new Date("2026-08-03T10:00:00.000Z");
const RETURN = new Date("2026-08-10T10:00:00.000Z");
const LOSS_AT = new Date("2026-08-07T10:00:00.000Z");

type Row = Record<string, unknown>;

function makeBooking(over: Row = {}) {
  return {
    id: "b1",
    bookingReference: "SCT-TERM-0001",
    status: "ACTIVE",
    customerId: "cust1",
    depotId: "depot1",
    vehicleId: "veh1",
    pickupDateTime: PICKUP,
    returnDateTime: RETURN,
    actualPickupDateTime: PICKUP,
    durationDays: 7,
    subtotal: 770,
    discountAmount: 70,
    addonTotal: 85, // 5×7 per-day + 50 one-off
    insuranceTotal: 105,
    gstAmount: 80.91,
    totalAmount: 890,
    amountPaid: 890,
    balanceDue: 0,
    addons: [
      { unitPrice: 5, quantity: 1, addon: { isPerDay: true } },
      { unitPrice: 50, quantity: 1, addon: { isPerDay: false } },
    ],
    insurance: [{ dailyRate: 15 }],
    customer: { id: "cust1", email: "c@x.io", firstName: "Vlad", lastName: "T" },
    bondLedger: null,
    termination: null,
    ...over,
  };
}

type PrismaOpts = {
  lateRows?: Array<{
    id: string;
    amount: number;
    status: string;
    reference: string;
    createdAt: Date;
  }>;
  pendingSum?: number;
  giftPaid?: number;
  sourcePayment?: Row | null;
  casCount?: number;
};

function makePrisma(booking: Row, opts: PrismaOpts = {}) {
  const lateRows = opts.lateRows ?? [];
  const tx = {
    booking: {
      updateMany: vi.fn().mockResolvedValue({ count: opts.casCount ?? 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    bookingStatusLog: { create: vi.fn().mockResolvedValue({}) },
    payment: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] } } }) =>
        lateRows.filter(
          (row) => row.status === "PENDING" && (where.id?.in ?? []).includes(row.id),
        ),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(async ({ data }: { data: Row }) => ({ id: `pay-${data.reference}`, ...data })),
    },
    bondLedger: { update: vi.fn().mockResolvedValue({}) },
    bookingTermination: {
      create: vi.fn(async ({ data }: { data: Row }) => ({ id: "term1", ...data })),
    },
    paymentEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    booking: { findUnique: vi.fn().mockResolvedValue(booking) },
    incident: { findUnique: vi.fn().mockResolvedValue({ id: "inc1" }) },
    payment: {
      findMany: vi.fn(async () => lateRows),
      aggregate: vi.fn(
        async ({ where }: { where: { type?: string } }) =>
          where.type === "GIFT_CARD_REDEMPTION"
            ? { _sum: { amount: -(opts.giftPaid ?? 0) } }
            : { _sum: { amount: opts.pendingSum ?? 0 } },
      ),
      findFirst: vi.fn(async ({ where }: { where: { type?: string; reference?: string } }) => {
        if (where.type === "BOOKING_PAYMENT") return opts.sourcePayment ?? null;
        if (where.reference) return { id: "failed-row-1" };
        return null;
      }),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    giftCard: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma: prisma as never, tx, raw: prisma };
}

const SOURCE_PAYMENT = {
  id: "src1",
  stripePaymentIntentId: "pi_src",
  stripeChargeId: "ch_src",
  processedAt: new Date("2026-08-04T00:00:00.000Z"),
  createdAt: new Date("2026-08-04T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreGiftCardMock.mockResolvedValue({ restored: 0 });
  refundChargeMock.mockResolvedValue({ id: "re_1", status: "succeeded" });
  cancelPaymentIntentMock.mockResolvedValue(true);
  issueGiftCardMock.mockResolvedValue({ id: "gc1", code: "SCOOT-TESTCODE" });
});

// ── Preview / refund math ──────────────────────────────────────────────────
describe("previewLossTermination — pro-rata math", () => {
  it("uses the discounted effective rate + per-day addons/insurance", async () => {
    const { prisma } = makePrisma(makeBooking());
    const q = await previewLossTermination(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "REFUND",
    });
    expect(q.unusedDays).toBe(3);
    expect(q.effectiveDailyRate).toBe(100); // (770-70)/7 — NOT 110 undiscounted
    expect(q.perDayAddonsTotal).toBe(5); // per-day addon only
    expect(q.perDayInsuranceRate).toBe(15);
    expect(q.grossUnusedValue).toBe(360); // 120 × 3
    expect(q.writedownAmount).toBe(360);
    expect(q.cashRefund).toBe(360); // fully paid, no unpaid balance to offset
    expect(q.cardRefundAmount).toBe(360);
    expect(q.giftRestoreAmount).toBe(0);
  });

  it("FORFEIT computes unusedDays but zero refund and zero write-down", async () => {
    const { prisma } = makePrisma(makeBooking());
    const q = await previewLossTermination(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "FORFEIT",
    });
    expect(q.unusedDays).toBe(3);
    expect(q.grossUnusedValue).toBe(360);
    expect(q.writedownAmount).toBe(0);
    expect(q.cashRefund).toBe(0);
  });

  it("offsets the unpaid (non-PENDING-backed) balance before refunding cash", async () => {
    // 200 unpaid hire balance, none of it backed by PENDING rows → the
    // write-down eats it first; only 160 comes back as cash.
    const { prisma } = makePrisma(
      makeBooking({ balanceDue: 200, amountPaid: 690 }),
      { pendingSum: 0 },
    );
    const q = await previewLossTermination(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "REFUND",
    });
    expect(q.balanceOffset).toBe(200);
    expect(q.cashRefund).toBe(160);
    expect(q.projectedBalanceDue).toBe(0);
  });

  it("restores the gift-card-funded slice first in REFUND mode", async () => {
    const { prisma } = makePrisma(makeBooking(), { giftPaid: 100 });
    const q = await previewLossTermination(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "REFUND",
    });
    expect(q.giftRestoreAmount).toBe(100);
    expect(q.cardRefundAmount).toBe(260);
  });

  it("rejects a non-terminatable status and never mutates", async () => {
    const { prisma, raw } = makePrisma(makeBooking({ status: "CONFIRMED" }));
    await expect(
      previewLossTermination(prisma, {
        bookingId: "b1",
        lossAt: LOSS_AT,
        refundMode: "REFUND",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(raw.$transaction).not.toHaveBeenCalled();
  });
});

// ── Terminate — settlement, completion, late fees, bond ────────────────────
describe("terminateBookingForLoss — REFUND settlement", () => {
  it("writes the invoice down, refunds via Stripe, records completion with post-write-down totals", async () => {
    const { prisma, tx, raw } = makePrisma(makeBooking(), {
      sourcePayment: SOURCE_PAYMENT,
    });
    const res = await terminateBookingForLoss(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "REFUND",
      cause: "WRITTEN_OFF",
      bondDisposition: "RELEASED",
      actorId: "mgr1",
    });

    // Stripe refund with the canonical idempotency key, outside the tx.
    expect(refundChargeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 36000,
        idempotencyKey: "term-refund-b1",
        paymentIntentId: "pi_src",
      }),
    );

    // CAS status flip carries the post-write-down totals.
    const cas = tx.booking.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(cas.where).toMatchObject({
      id: "b1",
      status: { in: ["ACTIVE", "CHECKED_OUT", "OVERDUE"] },
    });
    expect(cas.data).toMatchObject({
      status: "COMPLETED",
      actualReturnDateTime: LOSS_AT,
      checkedInById: "mgr1",
      subtotal: 470, // 770 − 100×3
      addonTotal: 70, // 85 − 5×3
      insuranceTotal: 60, // 105 − 15×3
      totalAmount: 530, // 890 − 360
      gstAmount: 48.18, // 80.91 − 32.73
    });

    // Status log carries the loss cause.
    expect(tx.bookingStatusLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newStatus: "COMPLETED",
          reason: "Terminated for loss: WRITTEN_OFF",
        }),
      }),
    );

    // Completion recorded IN the tx with the written-down totals.
    expect(recordBookingCompletionMock).toHaveBeenCalledTimes(1);
    const [txArg, completion] = recordBookingCompletionMock.mock.calls[0] as [
      unknown,
      { subtotal: unknown; addonTotal: unknown; gstAmount: unknown; totalAmount: unknown },
    ];
    expect(txArg).toBe(tx);
    expect(Number(completion.subtotal)).toBe(470);
    expect(Number(completion.addonTotal)).toBe(70);
    expect(Number(completion.gstAmount)).toBe(48.18);
    expect(Number(completion.totalAmount)).toBe(530);

    // Refund row + amountPaid decrement.
    const refundRow = tx.payment.create.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => d.reference === "TERM-REF-b1");
    expect(refundRow).toMatchObject({ type: "REFUND", amount: 360, status: "SUCCEEDED" });
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { amountPaid: { decrement: 360 } } }),
    );

    // Termination row.
    expect(tx.bookingTermination.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cause: "WRITTEN_OFF",
          refundMode: "REFUND",
          unusedDays: 3,
          refundAmount: 360,
          bondDisposition: "RELEASED",
          terminatedById: "mgr1",
        }),
      }),
    );

    // Adjustment note DECREASE / TERMINATION with the GST-inclusive line.
    expect(tryIssueAdjustmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DECREASE",
        reason: "TERMINATION",
        lineItems: [
          expect.objectContaining({
            description: "Unused hire days — vehicle lost in service (3 days)",
            totalPrice: 360,
            gstAmount: 32.73,
            gstIncluded: true,
          }),
        ],
      }),
    );

    expect(invalidateRevenueCachesMock).toHaveBeenCalledWith("depot1");
    expect(res.status).toBe("COMPLETED");
    expect(res.refundAmount).toBe(360);
    expect(res.cardRefundOutcome).toBe("SUCCEEDED");
    expect(raw.$transaction).toHaveBeenCalledTimes(1);
  });

  it("FORFEIT: no refund, no write-down, no adjustment note — totals unchanged", async () => {
    const { prisma, tx } = makePrisma(makeBooking(), { sourcePayment: SOURCE_PAYMENT });
    const res = await terminateBookingForLoss(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "FORFEIT",
      cause: "STOLEN",
      bondDisposition: "HELD_FOR_CLAIM",
      actorId: "mgr1",
    });
    expect(refundChargeMock).not.toHaveBeenCalled();
    expect(tryIssueAdjustmentMock).not.toHaveBeenCalled();
    const cas = tx.booking.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(cas.data).toMatchObject({ subtotal: 770, totalAmount: 890, gstAmount: 80.91 });
    expect(res.refundAmount).toBe(0);
    expect(res.unusedDays).toBe(3);
    const [, completion] = recordBookingCompletionMock.mock.calls[0] as [
      unknown,
      { totalAmount: unknown },
    ];
    expect(Number(completion.totalAmount)).toBe(890);
  });

  it("falls back to a PENDING MANUAL_CREDIT row when the source charge is >180d old", async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    const { prisma, tx } = makePrisma(makeBooking(), {
      sourcePayment: { ...SOURCE_PAYMENT, processedAt: old, createdAt: old },
    });
    const res = await terminateBookingForLoss(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "REFUND",
      cause: "WRITTEN_OFF",
      bondDisposition: "RELEASED",
      actorId: "mgr1",
    });
    expect(refundChargeMock).not.toHaveBeenCalled();
    const creditRow = tx.payment.create.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => d.reference === "TERM-CREDIT-b1");
    expect(creditRow).toMatchObject({ type: "MANUAL_CREDIT", status: "PENDING", amount: 360 });
    expect(res.cardRefundOutcome).toBe("MANUAL_CREDIT");
    // No cash left via Stripe → amountPaid untouched.
    expect(tx.booking.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { amountPaid: { decrement: 360 } } }),
    );
  });

  it("failed Stripe refund → FAILED row + queued retry + manager alert", async () => {
    refundChargeMock.mockRejectedValue(new Error("card_declined"));
    const raw = makePrisma(makeBooking(), { sourcePayment: SOURCE_PAYMENT });
    (raw.raw.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "mgr9" }]);
    const res = await terminateBookingForLoss(raw.prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "REFUND",
      cause: "WRITTEN_OFF",
      bondDisposition: "RELEASED",
      actorId: "mgr1",
    });
    const refundRow = raw.tx.payment.create.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => d.reference === "TERM-REF-b1");
    expect(refundRow).toMatchObject({ status: "FAILED" });
    expect(enqueueRefundRetryMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "term-refund-b1", amountCents: 36000 }),
    );
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "mgr9", subject: expect.stringContaining("Refund FAILED") }),
    );
    expect(res.cardRefundOutcome).toBe("FAILED");
  });
});

describe("terminateBookingForLoss — late fees", () => {
  const LATE_ROWS = [
    {
      id: "L1",
      amount: 80,
      status: "PENDING",
      reference: "LATE-b1-D1",
      createdAt: new Date("2026-08-06T12:00:00.000Z"), // pre-loss
    },
    {
      id: "L2",
      amount: 80,
      status: "PENDING",
      reference: "LATE-b1-D2",
      createdAt: new Date("2026-08-08T12:00:00.000Z"), // post-loss
    },
    {
      id: "L3",
      amount: 80,
      status: "SUCCEEDED",
      reference: "LATE-b1-D0",
      createdAt: new Date("2026-08-05T12:00:00.000Z"), // already collected
    },
  ];

  it("cancels post-loss PENDING late fees and decrements balanceDue by exactly their sum", async () => {
    const { prisma, tx } = makePrisma(
      makeBooking({ status: "OVERDUE", balanceDue: 160 }),
      { lateRows: LATE_ROWS, pendingSum: 160, sourcePayment: SOURCE_PAYMENT },
    );
    const res = await terminateBookingForLoss(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "REFUND",
      cause: "WRITTEN_OFF",
      bondDisposition: "RELEASED",
      actorId: "mgr1",
    });
    // Only L2 (post-loss) voided.
    const voidCall = tx.payment.updateMany.mock.calls[0]![0] as {
      where: { id: { in: string[] } };
      data: { status: string };
    };
    expect(voidCall.where.id.in).toEqual(["L2"]);
    expect(voidCall.data.status).toBe("FAILED");
    // balanceDue symmetry: decrement equals the cancelled sum (80), then clamp.
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balanceDue: { decrement: 80 } } }),
    );
    expect(res.cancelledLateFees).toBe(80);
    expect(res.waivedLateFeeAmount).toBe(0);
    // Void parity with booking-settlement.voidPayment: the payment console's
    // event history records the status change.
    expect(tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentId: "L2",
          eventType: "STATUS_CHANGED",
          previousStatus: "PENDING",
          newStatus: "FAILED",
          source: "staff:terminateForLoss",
        }),
      }),
    );
  });

  it("waiveAccruedLateFees extends the cancel to pre-loss PENDING rows and records the waived amount", async () => {
    const { prisma, tx } = makePrisma(
      makeBooking({ status: "OVERDUE", balanceDue: 160 }),
      { lateRows: LATE_ROWS, pendingSum: 160, sourcePayment: SOURCE_PAYMENT },
    );
    const res = await terminateBookingForLoss(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "REFUND",
      waiveAccruedLateFees: true,
      cause: "WRITTEN_OFF",
      bondDisposition: "RELEASED",
      actorId: "mgr1",
    });
    const voidCall = tx.payment.updateMany.mock.calls[0]![0] as {
      where: { id: { in: string[] } };
    };
    expect([...voidCall.where.id.in].sort()).toEqual(["L1", "L2"]);
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balanceDue: { decrement: 160 } } }),
    );
    // The discretionary (pre-loss) slice is what counts as waived; collected
    // SUCCEEDED fees stay collected (no DECREASE slice for them by design).
    expect(res.waivedLateFeeAmount).toBe(80);
    expect(res.cancelledLateFees).toBe(160);
  });
});

describe("terminateBookingForLoss — bond dispositions", () => {
  const HELD_BOND = {
    id: "bond1",
    status: "HELD",
    heldAmount: 500,
    capturedAmount: 0,
    releasedAmount: 0,
    stripePaymentIntentId: "pi_bond",
  };

  it("RELEASED cancels the PI, writes BOND_RELEASE + flips the ledger", async () => {
    const { prisma, tx } = makePrisma(makeBooking({ bondLedger: HELD_BOND }), {
      sourcePayment: SOURCE_PAYMENT,
    });
    const res = await terminateBookingForLoss(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "REFUND",
      cause: "WRITTEN_OFF",
      bondDisposition: "RELEASED",
      actorId: "mgr1",
    });
    expect(cancelPaymentIntentMock).toHaveBeenCalledWith("pi_bond");
    expect(tx.bondLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RELEASED", releasedAmount: 500 }),
      }),
    );
    const releaseRow = tx.payment.create.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => d.reference === "TERM-RELEASE-b1");
    expect(releaseRow).toMatchObject({ type: "BOND_RELEASE", amount: 500, status: "SUCCEEDED" });
    expect(res.bondReleasedAmount).toBe(500);
  });

  it("HELD_FOR_CLAIM leaves the ledger HELD (no Stripe cancel, no ledger write)", async () => {
    const { prisma, tx } = makePrisma(makeBooking({ bondLedger: HELD_BOND }), {
      sourcePayment: SOURCE_PAYMENT,
    });
    await terminateBookingForLoss(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "FORFEIT",
      cause: "STOLEN",
      bondDisposition: "HELD_FOR_CLAIM",
      actorId: "mgr1",
    });
    expect(cancelPaymentIntentMock).not.toHaveBeenCalled();
    expect(tx.bondLedger.update).not.toHaveBeenCalled();
  });

  it("CAPTURED_VIA_INCIDENT is a no-op on the bond", async () => {
    const { prisma, tx } = makePrisma(makeBooking({ bondLedger: HELD_BOND }), {
      sourcePayment: SOURCE_PAYMENT,
    });
    await terminateBookingForLoss(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "FORFEIT",
      cause: "STOLEN",
      bondDisposition: "CAPTURED_VIA_INCIDENT",
      actorId: "mgr1",
    });
    expect(cancelPaymentIntentMock).not.toHaveBeenCalled();
    expect(tx.bondLedger.update).not.toHaveBeenCalled();
  });
});

describe("terminateBookingForLoss — CREDIT mode", () => {
  it("issues an ACTIVE gift card for the surplus and stores creditGiftCardId", async () => {
    const { prisma, tx } = makePrisma(makeBooking());
    const res = await terminateBookingForLoss(prisma, {
      bookingId: "b1",
      lossAt: LOSS_AT,
      refundMode: "CREDIT",
      cause: "DESTROYED",
      bondDisposition: "RELEASED",
      actorId: "mgr1",
    });
    expect(issueGiftCardMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amount: 360,
        recipientEmail: "c@x.io",
        status: "ACTIVE",
      }),
    );
    expect(refundChargeMock).not.toHaveBeenCalled();
    expect(tx.bookingTermination.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          refundMode: "CREDIT",
          refundAmount: 360,
          creditGiftCardId: "gc1",
        }),
      }),
    );
    const creditRow = tx.payment.create.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => d.reference === "TERM-CREDIT-GC-b1");
    expect(creditRow).toMatchObject({ type: "REFUND", amount: 360, status: "SUCCEEDED" });
    expect(res.creditGiftCardCode).toBe("SCOOT-TESTCODE");
  });

  it("voids the issued card if the terminal transaction fails", async () => {
    const { prisma, raw } = makePrisma(makeBooking(), { casCount: 0 });
    await expect(
      terminateBookingForLoss(prisma, {
        bookingId: "b1",
        lossAt: LOSS_AT,
        refundMode: "CREDIT",
        cause: "DESTROYED",
        bondDisposition: "RELEASED",
        actorId: "mgr1",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(raw.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "gc1" }, data: { status: "VOIDED" } }),
    );
  });
});
