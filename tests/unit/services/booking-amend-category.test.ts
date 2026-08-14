import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Collaborator mocks ─────────────────────────────────────────────────────
const refundChargeMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
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
const restoreGiftCardMock = vi.fn().mockResolvedValue({ restored: 0 });
vi.mock("@/server/services/gift-card", () => ({
  restoreGiftCardForBooking: (...a: unknown[]) => restoreGiftCardMock(...a),
}));
const quotePricingMock = vi.fn();
vi.mock("@/server/services/pricing", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  quote: (...a: unknown[]) => quotePricingMock(...a),
}));
const countAvailableMock = vi.fn();
const acquireAllocationLockMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/availability", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  acquireAllocationLock: (...a: unknown[]) => acquireAllocationLockMock(...a),
  countAvailable: (...a: unknown[]) => countAvailableMock(...a),
}));
const checkEligibilityMock = vi.fn();
vi.mock("@/server/services/eligibility", () => ({
  checkEligibility: (...a: unknown[]) => checkEligibilityMock(...a),
}));
const writeAuditMock = vi.fn().mockResolvedValue(undefined);
const writeCustomerAuditAsyncMock = vi.fn();
vi.mock("@/server/services/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAuditMock(...a),
  writeCustomerAuditAsync: (...a: unknown[]) => writeCustomerAuditAsyncMock(...a),
}));
const invalidateAvailabilityMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/availability-cache", () => ({
  invalidateAvailability: (...a: unknown[]) => invalidateAvailabilityMock(...a),
}));
const enqueueRefundRetryMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/jobs/refund-retry", () => ({
  enqueueRefundRetry: (...a: unknown[]) => enqueueRefundRetryMock(...a),
}));
vi.mock("@/lib/analytics", () => ({
  trackServer: vi.fn().mockResolvedValue(undefined),
}));

import {
  previewCategoryAmendment,
  applyCategoryAmendment,
} from "@/server/services/booking-amend-category";

// ── Fixture ────────────────────────────────────────────────────────────────
// CONFIRMED 5-day hire: base subtotal 400, add-ons 50, insurance 55 (frozen),
// total 505, fully paid, bond 300. New category quotes base 500 + add-ons 50
// = 550 (quote excludes insurance); carried insurance makes the new total
// 605 → upgrade delta +100.
const PICKUP = new Date("2026-09-01T00:00:00.000Z");
const RETURN = new Date("2026-09-06T00:00:00.000Z");

type Row = Record<string, unknown>;

function makeBooking(over: Row = {}) {
  return {
    id: "b1",
    bookingReference: "XPM-AMEND-0001",
    status: "CONFIRMED",
    customerId: "cust1",
    depotId: "depot1",
    pickupDepotId: "depot1",
    returnDepotId: "depot1",
    categoryId: "cat-old",
    vehicleId: "veh1",
    pickupDateTime: PICKUP,
    returnDateTime: RETURN,
    durationDays: 5,
    subtotal: 400,
    discountAmount: 0,
    addonTotal: 50,
    insuranceTotal: 55,
    deliveryFee: 0,
    gstAmount: 45.91,
    totalAmount: 505,
    amountPaid: 505,
    balanceDue: 0,
    bondAmount: 300,
    extensionOfId: null,
    subscriptionId: null,
    pricingSnapshot: { totalAmount: 505 },
    addons: [{ addonId: "a1", quantity: 1 }],
    category: { id: "cat-old", name: "Scooter 50cc", bondAmount: 300 },
    customer: { id: "cust1", email: "c@x.io", firstName: "Vlad", lastName: "T" },
    billingPlan: null,
    bondLedger: null,
    ...over,
  };
}

const NEW_CATEGORY = {
  id: "cat-new",
  name: "Motorbike 300",
  bondAmount: 500,
  isActive: true,
  licenceRequired: "R",
  minAge: 21,
};

const CUSTOMER = {
  dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
  customerProfile: {
    licenceClass: "R",
    licenceExpiry: new Date("2030-01-01T00:00:00.000Z"),
    passportNumber: null,
    passportExpiry: null,
  },
};

type PrismaOpts = {
  casCount?: number;
  priorAmendCharges?: number;
  signedAgreements?: number;
  giftPaid?: number;
  sourcePayment?: Row | null;
  newCategory?: Row | null;
  /** Pre-existing AMEND-REF- / AMEND-REF-GC- / AMEND-CREDIT- rows for the
   *  refund-sequence max-suffix scan. */
  priorRefundRefs?: Array<{ reference: string }>;
};

function makePrisma(booking: Row, opts: PrismaOpts = {}) {
  const tx = {
    booking: {
      updateMany: vi.fn(async () => ({ count: opts.casCount ?? 1 })),
      findUniqueOrThrow: vi.fn(async () => ({ amountPaid: booking.amountPaid })),
      update: vi.fn(async () => ({})),
    },
    bookingNote: { create: vi.fn(async (_args: { data: { note: string } }) => ({})) },
    bookingStatusLog: { create: vi.fn(async () => ({})) },
    payment: {
      count: vi.fn(async () => opts.priorAmendCharges ?? 0),
      create: vi.fn(async ({ data }: { data: Row }) => ({
        id: `pay-${data.reference}`,
        ...data,
      })),
    },
    rentalAgreement: {
      updateMany: vi.fn(async () => ({ count: opts.signedAgreements ?? 0 })),
    },
  };
  const prisma = {
    booking: {
      findUnique: vi.fn(async () => booking),
      findUniqueOrThrow: vi.fn(async () => ({ amountPaid: booking.amountPaid })),
      update: vi.fn(async () => ({})),
    },
    vehicleCategory: {
      findUnique: vi.fn(async () =>
        opts.newCategory === undefined ? NEW_CATEGORY : opts.newCategory,
      ),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => CUSTOMER),
      findMany: vi.fn(async () => []),
    },
    rentalAgreement: { count: vi.fn(async () => opts.signedAgreements ?? 0) },
    payment: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => opts.priorRefundRefs ?? []), // AMEND-* refund seq scan
      aggregate: vi.fn(async () => ({ _sum: { amount: -(opts.giftPaid ?? 0) } })),
      findFirst: vi.fn(
        async ({ where }: { where: { type?: string; reference?: string } }) => {
          if (where.type === "BOOKING_PAYMENT") return opts.sourcePayment ?? null;
          if (where.reference) return { id: `pay-${where.reference}` };
          return null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Row }) => ({
        id: `pay-${data.reference}`,
        ...data,
      })),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma: prisma as never, tx, raw: prisma };
}

const SOURCE_PAYMENT = {
  id: "src1",
  stripePaymentIntentId: "pi_src",
  stripeChargeId: "ch_src",
  processedAt: new Date(),
  createdAt: new Date(),
};

function makeQuote(over: Record<string, number> = {}) {
  return { baseSubtotal: 500, addonTotal: 50, totalAmount: 550, durationDays: 5, ...over };
}

const BASE_APPLY = {
  bookingId: "b1",
  newCategoryId: "cat-new",
  mode: "CHARGE_DELTA" as const,
  actorId: "staff1",
  allowNegativeDelta: false,
};

function casCall(tx: { booking: { updateMany: ReturnType<typeof vi.fn> } }) {
  return tx.booking.updateMany.mock.calls[0]![0] as {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  quotePricingMock.mockResolvedValue(makeQuote());
  countAvailableMock.mockResolvedValue({ total: 3, available: 2 });
  checkEligibilityMock.mockReturnValue({ failure: null, basis: "licence", warnings: [] });
  restoreGiftCardMock.mockResolvedValue({ restored: 0 });
  refundChargeMock.mockResolvedValue({ id: "re_1", status: "succeeded" });
});

// ── Upgrade (INCREASE) ─────────────────────────────────────────────────────
describe("applyCategoryAmendment — CHARGE_DELTA upgrade", () => {
  it("CAS-writes the repriced booking and raises a PENDING AMEND charge with GST/11", async () => {
    const { prisma, tx } = makePrisma(makeBooking());
    const res = await applyCategoryAmendment(prisma, BASE_APPLY);

    const cas = casCall(tx);
    // CAS keys on the exact previewed state.
    expect(cas.where).toMatchObject({
      id: "b1",
      status: "CONFIRMED",
      categoryId: "cat-old",
      totalAmount: 505,
    });
    expect(cas.data).toMatchObject({
      categoryId: "cat-new",
      bondAmount: 500, // new category's bond
      vehicleId: null, // pre-assigned vehicle released — allocation at check-out
      subtotal: 500, // quote's base component
      addonTotal: 50,
      totalAmount: 605, // 550 quoted + 55 frozen insurance
      gstAmount: 55, // 605 / 11 via gstFromInclusive
      balanceDue: 100, // 0 + delta, incremented in the SAME guarded write
    });
    const snapshot = cas.data.pricingSnapshot as { amendments: Row[] };
    expect(snapshot.amendments).toHaveLength(1);
    expect(snapshot.amendments[0]).toMatchObject({
      actorId: "staff1",
      mode: "CHARGE_DELTA",
      oldCategoryId: "cat-old",
      newCategoryId: "cat-new",
      delta: 100,
    });

    // PENDING EXTENSION-type raise (already in the capture sweep's set).
    const payRow = tx.payment.create.mock.calls[0]![0] as { data: Row };
    expect(payRow.data).toMatchObject({
      reference: "AMEND-b1-1",
      type: "EXTENSION",
      method: "STRIPE",
      amount: 100,
      gstAmount: 9.09, // gstFromInclusive(100), rounded to cents
      status: "PENDING",
    });

    // INCREASE / AMENDMENT adjustment note linked to the raised payment.
    expect(tryIssueAdjustmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "INCREASE",
        reason: "AMENDMENT",
        paymentId: "pay-AMEND-b1-1",
        lineItems: [
          expect.objectContaining({ totalPrice: 100, gstAmount: 9.09, gstIncluded: true }),
        ],
      }),
    );

    expect(
      writeAuditMock.mock.calls.some(
        (c) => (c[1] as { action: string }).action === "BOOKING_CATEGORY_AMENDED",
      ),
    ).toBe(true);
    expect(invalidateAvailabilityMock).toHaveBeenCalledWith("depot1", PICKUP, RETURN);
    expect(acquireAllocationLockMock).toHaveBeenCalledWith(tx, "depot1", "cat-new");
    expect(refundChargeMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      direction: "INCREASE",
      delta: 100,
      newTotal: 605,
      newBalanceDue: 100,
      newBondAmount: 500,
      paymentReference: "AMEND-b1-1",
      refundOutcome: "NONE",
    });
  });

  it("sequences AMEND-<id>-<seq> from prior amendment charges", async () => {
    const { prisma, tx } = makePrisma(makeBooking(), { priorAmendCharges: 2 });
    const res = await applyCategoryAmendment(prisma, BASE_APPLY);
    expect(res.paymentReference).toBe("AMEND-b1-3");
    expect((tx.payment.create.mock.calls[0]![0] as { data: Row }).data.reference).toBe(
      "AMEND-b1-3",
    );
  });

  it("supersedes a pre-signed agreement so check-out forces a re-sign", async () => {
    const { prisma, tx } = makePrisma(makeBooking(), { signedAgreements: 1 });
    const res = await applyCategoryAmendment(prisma, BASE_APPLY);
    expect(tx.rentalAgreement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "b1", status: "SIGNED" },
        data: expect.objectContaining({ status: "SUPERSEDED" }),
      }),
    );
    expect(res.agreementsSuperseded).toBe(1);
  });
});

// ── Downgrade (DECREASE) ───────────────────────────────────────────────────
describe("applyCategoryAmendment — CHARGE_DELTA downgrade", () => {
  beforeEach(() => {
    quotePricingMock.mockResolvedValue(makeQuote({ baseSubtotal: 300, totalAmount: 350 }));
    // newQuotedTotal 405 → delta −100 on a fully-paid booking → credit 100.
  });

  it("FORBIDDEN without allowNegativeDelta — no transaction, no refund", async () => {
    const { prisma, raw } = makePrisma(makeBooking());
    await expect(
      applyCategoryAmendment(prisma, { ...BASE_APPLY, allowNegativeDelta: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(raw.$transaction).not.toHaveBeenCalled();
    expect(refundChargeMock).not.toHaveBeenCalled();
  });

  it("manager downgrade: gift-funded slice restores first, remainder refunds via Stripe", async () => {
    const { prisma, tx, raw } = makePrisma(makeBooking(), {
      giftPaid: 40,
      sourcePayment: SOURCE_PAYMENT,
    });
    const res = await applyCategoryAmendment(prisma, {
      ...BASE_APPLY,
      allowNegativeDelta: true,
    });

    const cas = casCall(tx);
    expect(cas.data).toMatchObject({ totalAmount: 405, balanceDue: 0, subtotal: 300 });

    // Gift slice first (atomic tx): 40 back to the voucher.
    expect(restoreGiftCardMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bookingId: "b1", amount: 40 }),
    );
    const giftRow = tx.payment.create.mock.calls
      .map((c) => (c[0] as { data: Row }).data)
      .find((d) => d.reference === "AMEND-REF-GC-b1-1");
    expect(giftRow).toMatchObject({ type: "REFUND", amount: 40, status: "SUCCEEDED" });

    // Card slice via Stripe with the canonical idempotency key.
    expect(refundChargeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 6000,
        idempotencyKey: "amend-refund-b1-1",
        paymentIntentId: "pi_src",
      }),
    );
    const cardRow = raw.payment.create.mock.calls
      .map((c) => (c[0] as { data: Row }).data)
      .find((d) => d.reference === "AMEND-REF-b1-1");
    expect(cardRow).toMatchObject({ type: "REFUND", amount: 60, status: "SUCCEEDED" });

    expect(tryIssueAdjustmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DECREASE", reason: "AMENDMENT" }),
    );
    expect(res).toMatchObject({
      direction: "DECREASE",
      delta: -100,
      creditAmount: 100,
      refundOutcome: "SUCCEEDED",
      paymentReference: null,
    });
  });

  it("failed Stripe refund → FAILED row + queued retry + manager alert", async () => {
    refundChargeMock.mockRejectedValue(new Error("card_declined"));
    const { prisma, raw } = makePrisma(makeBooking(), { sourcePayment: SOURCE_PAYMENT });
    (raw.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "mgr9" }]);
    const res = await applyCategoryAmendment(prisma, {
      ...BASE_APPLY,
      allowNegativeDelta: true,
    });
    const cardRow = raw.payment.create.mock.calls
      .map((c) => (c[0] as { data: Row }).data)
      .find((d) => d.reference === "AMEND-REF-b1-1");
    expect(cardRow).toMatchObject({ status: "FAILED" });
    expect(enqueueRefundRetryMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "amend-refund-b1-1", amountCents: 10000 }),
    );
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "mgr9",
        subject: expect.stringContaining("Refund FAILED"),
      }),
    );
    expect(res.refundOutcome).toBe("FAILED");
  });

  it("source charge >180d old falls back to a PENDING MANUAL_CREDIT", async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    const { prisma, raw } = makePrisma(makeBooking(), {
      sourcePayment: { ...SOURCE_PAYMENT, processedAt: old, createdAt: old },
    });
    const res = await applyCategoryAmendment(prisma, {
      ...BASE_APPLY,
      allowNegativeDelta: true,
    });
    expect(refundChargeMock).not.toHaveBeenCalled();
    const creditRow = raw.payment.create.mock.calls
      .map((c) => (c[0] as { data: Row }).data)
      .find((d) => d.reference === "AMEND-CREDIT-b1-1");
    expect(creditRow).toMatchObject({ type: "MANUAL_CREDIT", status: "PENDING", amount: 100 });
    expect(res.refundOutcome).toBe("MANUAL_CREDIT");
  });
});

// ── Refund sequence robustness ─────────────────────────────────────────────
// The seq counter must see ALL THREE reference families. A gift-only or
// credit-only reduction writes no 'AMEND-REF-<id>-N' row, so a plain count
// of that family recomputes seq=1 on the next reduction and collides on the
// Payment.reference @unique — after the amendment tx already committed.
describe("applyCategoryAmendment — refund sequence across reference families", () => {
  beforeEach(() => {
    quotePricingMock.mockResolvedValue(makeQuote({ baseSubtotal: 300, totalAmount: 350 }));
  });

  it("a gift-only prior reduction bumps the seq for the next gift-only reduction", async () => {
    // giftPaid 200 covers the whole 100 credit → gift-only, no card slice.
    const { prisma, tx } = makePrisma(makeBooking(), {
      giftPaid: 200,
      priorRefundRefs: [{ reference: "AMEND-REF-GC-b1-1" }],
    });
    const res = await applyCategoryAmendment(prisma, {
      ...BASE_APPLY,
      allowNegativeDelta: true,
    });
    const giftRow = tx.payment.create.mock.calls
      .map((c) => (c[0] as { data: Row }).data)
      .find((d) => typeof d.reference === "string" && d.reference.startsWith("AMEND-REF-GC-"));
    expect(giftRow!.reference).toBe("AMEND-REF-GC-b1-2"); // NOT -1 again
    expect(refundChargeMock).not.toHaveBeenCalled();
    expect(res.refundOutcome).toBe("SUCCEEDED");
  });

  it("a credit-only prior reduction bumps the seq for the next >180d credit", async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    const { prisma, raw } = makePrisma(makeBooking(), {
      sourcePayment: { ...SOURCE_PAYMENT, processedAt: old, createdAt: old },
      priorRefundRefs: [{ reference: "AMEND-CREDIT-b1-1" }],
    });
    const res = await applyCategoryAmendment(prisma, {
      ...BASE_APPLY,
      allowNegativeDelta: true,
    });
    const creditRow = raw.payment.create.mock.calls
      .map((c) => (c[0] as { data: Row }).data)
      .find((d) => typeof d.reference === "string" && d.reference.startsWith("AMEND-CREDIT-"));
    expect(creditRow!.reference).toBe("AMEND-CREDIT-b1-2");
    expect(res.refundOutcome).toBe("MANUAL_CREDIT");
  });

  it("seq is the max suffix across mixed families, not a per-family count", async () => {
    const { prisma, raw } = makePrisma(makeBooking(), {
      sourcePayment: SOURCE_PAYMENT,
      priorRefundRefs: [
        { reference: "AMEND-REF-GC-b1-1" },
        { reference: "AMEND-REF-b1-3" },
        { reference: "AMEND-CREDIT-b1-2" },
      ],
    });
    await applyCategoryAmendment(prisma, { ...BASE_APPLY, allowNegativeDelta: true });
    const cardRow = raw.payment.create.mock.calls
      .map((c) => (c[0] as { data: Row }).data)
      .find((d) => d.reference === "AMEND-REF-b1-4");
    expect(cardRow).toMatchObject({ type: "REFUND", amount: 100 });
    expect(refundChargeMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "amend-refund-b1-4" }),
    );
  });

  it("a post-commit refund crash alerts managers instead of throwing a 500", async () => {
    const { prisma, raw } = makePrisma(makeBooking(), { sourcePayment: SOURCE_PAYMENT });
    // Crash the ladder before it can even write a FAILED row.
    (raw.payment.findMany as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("db connection lost"),
    );
    (raw.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "mgr9" }]);

    // The amendment already committed — apply must RESOLVE, not reject.
    const res = await applyCategoryAmendment(prisma, {
      ...BASE_APPLY,
      allowNegativeDelta: true,
    });
    expect(res.refundOutcome).toBe("FAILED");
    expect(res.newCategoryId).toBe("cat-new"); // amendment result intact
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "mgr9",
        subject: expect.stringContaining("Refund FAILED"),
        title: "Category-change refund needs manual action",
      }),
    );
  });
});

// ── balanceDue CAS guard ───────────────────────────────────────────────────
// The amendment writes an ABSOLUTE preview-derived balanceDue, so the CAS
// must also key on the previewed balance: a concurrent capture-sweep
// decrement between preview and commit forces CONFLICT/re-preview instead of
// being silently overwritten (collected debt resurrected).
describe("applyCategoryAmendment — balanceDue CAS guard", () => {
  it("keys the CAS on the previewed balanceDue whenever the write touches it", async () => {
    const { prisma, tx } = makePrisma(makeBooking({ balanceDue: 100, amountPaid: 405 }));
    await applyCategoryAmendment(prisma, BASE_APPLY);
    const cas = casCall(tx);
    expect(cas.where).toMatchObject({ balanceDue: 100 });
    expect(cas.data).toMatchObject({ balanceDue: 200 }); // 100 previewed + 100 delta
  });

  it("a concurrent capture-sweep decrement between preview and commit CONFLICTs — no resurrection", async () => {
    // Preview reads balanceDue 100; the sweep then collects 80 → DB now 20.
    const { prisma, tx } = makePrisma(makeBooking({ balanceDue: 100, amountPaid: 405 }));
    const dbBalanceDue = 20;
    (tx.booking.updateMany as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { balanceDue?: number } }) => ({
        count: where.balanceDue === dbBalanceDue ? 1 : 0,
      }),
    );
    await expect(applyCategoryAmendment(prisma, BASE_APPLY)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // Nothing settled under the stale preview: no charge row, no note.
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.bookingNote.create).not.toHaveBeenCalled();
    expect(refundChargeMock).not.toHaveBeenCalled();
  });

  it("a goodwill upgrade (no money write) does NOT guard balanceDue — no spurious conflicts", async () => {
    const { prisma, tx } = makePrisma(makeBooking({ balanceDue: 100 }));
    await applyCategoryAmendment(prisma, {
      ...BASE_APPLY,
      mode: "GOODWILL_FREE_UPGRADE",
      allowNegativeDelta: true,
      goodwillReason: "SERVICE_RECOVERY",
      goodwillNote: "Keeping their price.",
    });
    const cas = casCall(tx);
    expect(cas.where).not.toHaveProperty("balanceDue");
    expect(cas.data).not.toHaveProperty("balanceDue");
  });
});

// ── Goodwill free upgrade ──────────────────────────────────────────────────
describe("applyCategoryAmendment — GOODWILL_FREE_UPGRADE", () => {
  const GOODWILL = {
    ...BASE_APPLY,
    mode: "GOODWILL_FREE_UPGRADE" as const,
    allowNegativeDelta: true,
    goodwillReason: "SERVICE_RECOVERY" as const,
    goodwillNote: "Original bike written off — keeping their price.",
  };

  it("forces delta 0: category + bond move, invoice stays untouched, goodwill audited", async () => {
    const { prisma, tx } = makePrisma(makeBooking());
    const res = await applyCategoryAmendment(prisma, GOODWILL);

    const cas = casCall(tx);
    expect(cas.data).toMatchObject({ categoryId: "cat-new", bondAmount: 500, vehicleId: null });
    // Invoice untouched — no money keys in the write.
    expect(cas.data).not.toHaveProperty("totalAmount");
    expect(cas.data).not.toHaveProperty("subtotal");
    expect(cas.data).not.toHaveProperty("balanceDue");
    expect(cas.data).not.toHaveProperty("gstAmount");

    // No charge, no refund, no adjustment note (consideration unchanged).
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(refundChargeMock).not.toHaveBeenCalled();
    expect(tryIssueAdjustmentMock).not.toHaveBeenCalled();

    // First-class goodwill audit with the forgone revenue + reason payload.
    const goodwillAudit = writeAuditMock.mock.calls
      .map((c) => c[1] as { action: string; newData?: Row })
      .find((c) => c.action === "BOOKING_GOODWILL_UPGRADE");
    expect(goodwillAudit).toBeDefined();
    expect(goodwillAudit!.newData).toMatchObject({
      quotedDelta: 100,
      forgoneRevenue: 100,
      goodwillReason: "SERVICE_RECOVERY",
      goodwillNote: GOODWILL.goodwillNote,
    });

    expect(res).toMatchObject({ delta: 0, direction: "NONE", newTotal: 505, newBondAmount: 500 });
  });

  it("rejects goodwill when the new category prices BELOW the current one", async () => {
    quotePricingMock.mockResolvedValue(makeQuote({ baseSubtotal: 300, totalAmount: 350 }));
    const { prisma, raw } = makePrisma(makeBooking());
    await expect(applyCategoryAmendment(prisma, GOODWILL)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(raw.$transaction).not.toHaveBeenCalled();
  });

  it("rejects goodwill without a reason/note", async () => {
    const { prisma } = makePrisma(makeBooking());
    await expect(
      applyCategoryAmendment(prisma, { ...GOODWILL, goodwillNote: undefined }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ── Manager price override ─────────────────────────────────────────────────
describe("applyCategoryAmendment — MANAGER_PRICE_OVERRIDE", () => {
  it("settles the manager's custom delta instead of the quoted one", async () => {
    const { prisma, tx } = makePrisma(makeBooking(), { sourcePayment: SOURCE_PAYMENT });
    const res = await applyCategoryAmendment(prisma, {
      ...BASE_APPLY,
      mode: "MANAGER_PRICE_OVERRIDE",
      allowNegativeDelta: true,
      managerDelta: -30, // quoted delta is +100 — manager charges −30 instead
      overrideReason: "price-matched a quoted rate",
    });
    const cas = casCall(tx);
    expect(cas.data).toMatchObject({
      categoryId: "cat-new",
      totalAmount: 475, // 505 − 30
      subtotal: 370, // base component absorbs the override
      balanceDue: 0,
    });
    expect(refundChargeMock).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 3000 }),
    );
    expect(res).toMatchObject({ delta: -30, direction: "DECREASE", creditAmount: 30 });
    const snapshot = cas.data.pricingSnapshot as { amendments: Row[] };
    expect(snapshot.amendments[0]).toMatchObject({
      mode: "MANAGER_PRICE_OVERRIDE",
      overrideReason: "price-matched a quoted rate",
      quotedDelta: 100,
    });
  });

  it("rejects an override without a reason", async () => {
    const { prisma } = makePrisma(makeBooking());
    await expect(
      applyCategoryAmendment(prisma, {
        ...BASE_APPLY,
        mode: "MANAGER_PRICE_OVERRIDE",
        allowNegativeDelta: true,
        managerDelta: 10,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ── Gates ──────────────────────────────────────────────────────────────────
describe("category amendment gates", () => {
  it("rejects a non-CONFIRMED booking", async () => {
    const { prisma, raw } = makePrisma(makeBooking({ status: "ACTIVE" }));
    await expect(applyCategoryAmendment(prisma, BASE_APPLY)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(raw.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a discounted booking (code can't be re-applied)", async () => {
    const { prisma } = makePrisma(makeBooking({ discountAmount: 50 }));
    await expect(applyCategoryAmendment(prisma, BASE_APPLY)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("discount"),
    });
  });

  it("rejects a same-category no-op", async () => {
    const { prisma } = makePrisma(makeBooking());
    await expect(
      applyCategoryAmendment(prisma, { ...BASE_APPLY, newCategoryId: "cat-old" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("hard-blocks apply when the customer is not eligible for the new category", async () => {
    checkEligibilityMock.mockReturnValue({
      failure: { code: "LICENCE_CLASS", message: "R licence required." },
      basis: "none",
      warnings: [],
    });
    const { prisma, raw } = makePrisma(makeBooking());
    await expect(applyCategoryAmendment(prisma, BASE_APPLY)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "R licence required.",
    });
    expect(raw.$transaction).not.toHaveBeenCalled();
    // Preview reports the verdict instead of throwing.
    const preview = await previewCategoryAmendment(prisma, {
      bookingId: "b1",
      newCategoryId: "cat-new",
      mode: "CHARGE_DELTA",
    });
    expect(preview.eligibility).toMatchObject({ ok: false, message: "R licence required." });
  });

  it("CONFLICTs when no vehicle in the new category is available", async () => {
    countAvailableMock.mockResolvedValue({ total: 2, available: 0 });
    const { prisma } = makePrisma(makeBooking());
    await expect(applyCategoryAmendment(prisma, BASE_APPLY)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const preview = await previewCategoryAmendment(prisma, {
      bookingId: "b1",
      newCategoryId: "cat-new",
      mode: "CHARGE_DELTA",
    });
    expect(preview.availability).toMatchObject({ ok: false, available: 0 });
  });

  it("CAS conflict aborts settlement — no charge row, no refund, no note", async () => {
    const { prisma, tx } = makePrisma(makeBooking(), { casCount: 0 });
    await expect(applyCategoryAmendment(prisma, BASE_APPLY)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(refundChargeMock).not.toHaveBeenCalled();
    expect(tryIssueAdjustmentMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});

// ── Bond behaviour ─────────────────────────────────────────────────────────
describe("category amendment — bond", () => {
  it("updates bondAmount but never touches a HELD bond PI; the note records the variance", async () => {
    const { prisma, tx } = makePrisma(
      makeBooking({ bondLedger: { id: "bond1", status: "HELD", heldAmount: 300 } }),
    );
    const res = await applyCategoryAmendment(prisma, BASE_APPLY);
    expect(casCall(tx).data).toMatchObject({ bondAmount: 500 });
    // No Stripe interaction at all for the bond (no resize, no cancel).
    expect(refundChargeMock).not.toHaveBeenCalled();
    const note = (tx.bookingNote.create.mock.calls[0]![0] as { data: { note: string } }).data
      .note;
    expect(note).toContain("Bond changes");
    expect(note).toContain("re-authorised at the new amount at check-out");
    expect(res.newBondAmount).toBe(500);

    const preview = await previewCategoryAmendment(prisma, {
      bookingId: "b1",
      newCategoryId: "cat-new",
      mode: "CHARGE_DELTA",
    });
    expect(preview.bondHeld).toBe(true);
  });
});
