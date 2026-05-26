import { describe, expect, it, vi } from "vitest";

const reconcilePaymentsMock = vi.fn();
vi.mock("@/server/services/finance-reconciliation", () => ({
  reconcilePayments: (...a: unknown[]) => reconcilePaymentsMock(...a),
}));
const runStripeReconcileMock = vi.fn();
vi.mock("@/server/jobs/stripe-reconcile", () => ({
  runStripeReconcile: (...a: unknown[]) => runStripeReconcileMock(...a),
}));
const computeGstSummaryMock = vi.fn();
vi.mock("@/server/services/gst-bas-export", () => ({
  computeGstSummary: (...a: unknown[]) => computeGstSummaryMock(...a),
}));

import { adminRouter } from "../../../../src/server/trpc/router/admin";

function makeCtx(opts: {
  payments?: unknown[];
  groups?: unknown[];
  invoices?: unknown[];
  invoiceAgg?: unknown;
  role?: string | null;
} = {}) {
  const prisma = {
    payment: {
      findMany: vi.fn().mockResolvedValue(opts.payments ?? []),
      groupBy: vi.fn().mockResolvedValue(opts.groups ?? []),
    },
    invoice: {
      findMany: vi.fn().mockResolvedValue(opts.invoices ?? []),
      aggregate: vi.fn().mockResolvedValue(
        opts.invoiceAgg ?? {
          _sum: { totalAmount: 0, gstAmount: 0, subtotal: 0 },
          _count: 0,
        },
      ),
    },
  };
  const session =
    opts.role === null
      ? null
      : {
          user: { id: "u1", role: opts.role ?? "ADMIN" },
          pending2fa: false,
          requiresOnboarding: false,
        };
  const ctx = {
    prisma,
    session,
    headers: undefined,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  };
  return { ctx: ctx as never, prisma };
}

const range = { from: new Date("2026-05-01"), to: new Date("2026-05-31") };

describe("admin.financeTransactions", () => {
  it("signs outflow rows negative and inflow rows positive", async () => {
    const { ctx } = makeCtx({
      payments: [
        { id: "p1", reference: "PAY-1", createdAt: new Date(), type: "BOOKING_PAYMENT", method: "STRIPE", status: "SUCCEEDED", amount: 172.5, gstAmount: 15.68, booking: { bookingReference: "SCT-1" }, customer: { firstName: "Vlad", lastName: "S" } },
        { id: "p2", reference: "REF-1", createdAt: new Date(), type: "REFUND", method: "STRIPE", status: "SUCCEEDED", amount: 147.5, gstAmount: 0, booking: { bookingReference: "SCT-1" }, customer: { firstName: "Vlad", lastName: "S" } },
        { id: "p3", reference: "BOND-1", createdAt: new Date(), type: "BOND_RELEASE", method: "STRIPE", status: "SUCCEEDED", amount: 300, gstAmount: 0, booking: { bookingReference: "SCT-1" }, customer: { firstName: "Vlad", lastName: "S" } },
      ],
    });
    const caller = adminRouter.createCaller(ctx);
    const res = await caller.financeTransactions(range);
    // Refund negative (cash out), bond release shown as positive magnitude (non-cash).
    expect(res.rows.map((r) => r.amount)).toEqual([172.5, -147.5, 300]);
  });

  it("nets the summary across the whole set: refunds subtract, bond releases excluded", async () => {
    const { ctx } = makeCtx({
      groups: [
        { type: "BOOKING_PAYMENT", _sum: { amount: 172.5, gstAmount: 15.68 }, _count: { _all: 1 } },
        { type: "REFUND", _sum: { amount: 147.5, gstAmount: 13.41 }, _count: { _all: 1 } },
        { type: "BOND_RELEASE", _sum: { amount: 300, gstAmount: 0 }, _count: { _all: 1 } },
      ],
    });
    const caller = adminRouter.createCaller(ctx);
    const res = await caller.financeTransactions(range);
    // 172.50 − 147.50 (bond release contributes 0): true cash net.
    expect(res.totals.amount).toBeCloseTo(25, 2);
    // 15.68 − 13.41 GST credit.
    expect(res.totals.gst).toBeCloseTo(2.27, 2);
    // count still tallies every row, bonds included.
    expect(res.totals.count).toBe(3);
  });

  it("rejects callers without an admin session", async () => {
    const { ctx } = makeCtx({ role: null });
    const caller = adminRouter.createCaller(ctx);
    await expect(caller.financeTransactions(range)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("admin.financeInvoices", () => {
  it("reconciles adjustments and net cash into the invoice row", async () => {
    const { ctx } = makeCtx({
      invoices: [
        {
          id: "inv1",
          invoiceNumber: "INV-2026-000016",
          status: "SENT",
          bookingId: "bk1",
          subtotal: 313.64,
          gstAmount: 31.36,
          totalAmount: 345,
          dueDate: null,
          sentAt: new Date(),
          paidAt: null,
          createdAt: new Date(),
          // Cancelled booking (terminal), settled: balanceDue 0.
          booking: { bookingReference: "SCT-1", status: "CANCELLED", balanceDue: 0, customer: { firstName: "Vlad", lastName: "S" } },
          creditNotes: [],
          // Cancellation refund recorded as a DECREASE adjustment note.
          adjustmentNotes: [{ type: "DECREASE", totalAmount: 147.5 }],
        },
      ],
      invoiceAgg: { _sum: { totalAmount: 345, gstAmount: 31.36, subtotal: 313.64 }, _count: 1 },
      // Booking payment $172.50 (partially refunded), refund −$147.50, bond release $300.
      groups: [
        { bookingId: "bk1", type: "BOOKING_PAYMENT", _sum: { amount: 172.5 } },
        { bookingId: "bk1", type: "REFUND", _sum: { amount: 147.5 } },
        { bookingId: "bk1", type: "BOND_RELEASE", _sum: { amount: 300 } },
      ],
    });
    const caller = adminRouter.createCaller(ctx);
    const res = await caller.financeInvoices(range);
    const row = res.rows[0]!;
    expect(row.bookingStatus).toBe("CANCELLED");
    // DECREASE adjustment is signed negative.
    expect(row.adjustmentTotal).toBeCloseTo(-147.5, 2);
    // Net consideration = 345 − 147.50.
    expect(row.netTotal).toBeCloseTo(197.5, 2);
    // Net cash = 172.50 − 147.50, bond release contributes 0.
    expect(row.collected).toBeCloseTo(25, 2);
    // Cancelled (terminal) + settled: outstanding driven by balanceDue, not net − collected.
    expect(row.outstanding).toBe(0);
    // Totals tie out to the rows shown.
    expect(res.totals.collected).toBeCloseTo(25, 2);
    expect(res.totals.outstanding).toBe(0);
  });

  it("treats an invoice with no booking and no activity as fully outstanding", async () => {
    const { ctx, prisma } = makeCtx({
      invoices: [
        {
          id: "inv2",
          invoiceNumber: "INV-2026-000017",
          status: "SENT",
          bookingId: null,
          subtotal: 90.91,
          gstAmount: 9.09,
          totalAmount: 100,
          dueDate: null,
          sentAt: new Date(),
          paidAt: null,
          createdAt: new Date(),
          booking: null,
          creditNotes: [],
          adjustmentNotes: [],
        },
      ],
      invoiceAgg: { _sum: { totalAmount: 100, gstAmount: 9.09, subtotal: 90.91 }, _count: 1 },
    });
    const caller = adminRouter.createCaller(ctx);
    const res = await caller.financeInvoices(range);
    const row = res.rows[0]!;
    expect(row.adjustmentTotal).toBe(0);
    expect(row.collected).toBe(0);
    expect(row.outstanding).toBeCloseTo(100, 2);
    // No bookingIds → payment.groupBy must not be queried.
    expect(prisma.payment.groupBy).not.toHaveBeenCalled();
  });

  it("rejects callers without an admin session", async () => {
    const { ctx } = makeCtx({ role: null });
    const caller = adminRouter.createCaller(ctx);
    await expect(caller.financeInvoices(range)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("admin.financeSummary", () => {
  function makeSummaryCtx() {
    const prisma = {
      payment: {
        groupBy: vi
          .fn()
          // 1) cashGroups (by type) — settled-cash payments in the window.
          .mockResolvedValueOnce([
            { type: "BOOKING_PAYMENT", _sum: { amount: 172.5 } },
            { type: "REFUND", _sum: { amount: 147.5 } },
            { type: "BOND_RELEASE", _sum: { amount: 300 } },
            { type: "DAMAGE_CHARGE", _sum: { amount: 40 } },
          ])
          // 2) invPaymentGroups (by bookingId, type) — for invoices-outstanding.
          .mockResolvedValueOnce([
            { bookingId: "bk1", type: "BOOKING_PAYMENT", _sum: { amount: 172.5 } },
            { bookingId: "bk1", type: "REFUND", _sum: { amount: 147.5 } },
          ]),
      },
      booking: {
        // 1) gross-booked aggregate (non-cancelled) → empty, then 2) outstanding.
        aggregate: vi
          .fn()
          .mockResolvedValueOnce({ _sum: { totalAmount: 0, addonTotal: 0, insuranceTotal: 0 }, _count: 0, _avg: { totalAmount: null } })
          .mockResolvedValueOnce({ _sum: { balanceDue: 0 }, _count: 0 }),
        groupBy: vi.fn().mockResolvedValue([{ status: "CANCELLED", _count: 1, _sum: { totalAmount: 345 } }]),
      },
      bondLedger: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { heldAmount: 300, capturedAmount: 0, releasedAmount: 300 } }),
      },
      invoice: {
        findMany: vi.fn().mockResolvedValue([
          {
            bookingId: "bk1",
            totalAmount: 345,
            booking: { status: "CANCELLED", balanceDue: 0 },
            adjustmentNotes: [{ type: "DECREASE", totalAmount: 147.5 }],
          },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ under30: "0", under60: "0", under90: "0", over90: "0" }]),
    };
    const ctx = {
      prisma,
      session: { user: { id: "u1", role: "ADMIN" }, pending2fa: false, requiresOnboarding: false },
      headers: undefined,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    };
    return ctx as never;
  }

  it("reports payment-weighted net cash, excludes bond auths, keeps gross-booked pipeline", async () => {
    // computeGstSummary is the authoritative net-cash/GST source (mocked here).
    computeGstSummaryMock.mockResolvedValue({
      totalRevenueInc: 65,
      totalRevenueEx: 59.09,
      gstCollected: 19.32,
      gstOnRefunds: 13.41,
      netGst: 5.91,
      byDepot: [],
    });
    const res = await adminRouter.createCaller(makeSummaryCtx()).financeSummary(range);

    // Headline net cash + GST come straight from computeGstSummary.
    expect(res.cash.revenueInc).toBe(65);
    expect(res.cash.netGst).toBeCloseTo(5.91, 2);
    // Inflows = booking payment 172.50 + damage 40; outflow = refund 147.50;
    // the $300 bond release is a non-cash authorisation and is excluded.
    expect(res.cash.inflows).toBeCloseTo(212.5, 2);
    expect(res.cash.outflows).toBeCloseTo(147.5, 2);
    expect(res.cash.net).toBeCloseTo(65, 2);
    expect(res.cash.byType.BOND_RELEASE).toBeUndefined();
    expect(res.cash.byType.REFUND).toBeCloseTo(-147.5, 2);
    // The cancelled $345 booking is dropped from cash but still reported as
    // gross-booked pipeline under byStatus.
    expect(res.booking.byStatus).toEqual([{ status: "CANCELLED", count: 1, revenue: 345 }]);
    expect(res.totals.refunds).toBeCloseTo(147.5, 2);
    expect(res.totals.damage).toBeCloseTo(40, 2);
    // Cancelled (terminal) invoice with balanceDue 0 → nothing outstanding.
    expect(res.invoicesOutstanding.amount).toBe(0);
    expect(res.invoicesOutstanding.count).toBe(0);
  });

  it("rejects callers without an admin session", async () => {
    const { ctx } = makeCtx({ role: null });
    await expect(adminRouter.createCaller(ctx).financeSummary(range)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("admin.financeRecurring", () => {
  // Two ACTIVE weekly plans, both due "now" (nextChargeAt in the past so their
  // projected charges land inside the 14-day forecast window).
  const soon = new Date(Date.now() + 24 * 3600 * 1000); // tomorrow → inside window
  function makeRecurringCtx() {
    const prisma = {
      bookingBillingPlan: {
        groupBy: vi
          .fn()
          // 1) by status
          .mockResolvedValueOnce([
            { status: "ACTIVE", _count: { _all: 2 } },
            { status: "PAUSED", _count: { _all: 1 } },
            { status: "COMPLETED", _count: { _all: 5 } },
          ])
          // 2) by frequency (ACTIVE only)
          .mockResolvedValueOnce([
            { frequency: "WEEKLY", _count: { _all: 2 }, _sum: { amountPerPeriod: 1009 } },
          ]),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "plan1",
            frequency: "WEEKLY",
            amountPerPeriod: 504,
            periodsCompleted: 1,
            periodsTotal: 3, // remaining 2 → committed 1008
            nextChargeAt: soon,
            status: "ACTIVE",
            booking: { bookingReference: "SCT-1", customer: { firstName: "Vlad", lastName: "S" } },
          },
          {
            id: "plan2",
            frequency: "WEEKLY",
            amountPerPeriod: 505,
            periodsCompleted: 0,
            periodsTotal: 1, // remaining 1 → committed 505
            nextChargeAt: soon,
            status: "ACTIVE",
            booking: { bookingReference: "SCT-2", customer: { firstName: "Mia", lastName: "T" } },
          },
        ]),
      },
      payment: {
        groupBy: vi.fn().mockResolvedValue([
          { status: "SUCCEEDED", _count: { _all: 8 }, _sum: { amount: 4032 } },
          { status: "FAILED", _count: { _all: 2 }, _sum: { amount: 1008 } },
          { status: "PENDING", _count: { _all: 1 }, _sum: { amount: 504 } },
        ]),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const ctx = {
      prisma,
      session: { user: { id: "u1", role: "ADMIN" }, pending2fa: false, requiresOnboarding: false },
      headers: undefined,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    };
    return ctx as never;
  }

  it("aggregates committed revenue, status counts, forecast and capture health", async () => {
    const res = await adminRouter.createCaller(makeRecurringCtx()).financeRecurring({});
    // Committed = remaining periods × amount: (2×504) + (1×505) = 1513.
    expect(res.kpis.committedRevenue).toBeCloseTo(1513, 2);
    expect(res.kpis.activePlans).toBe(2);
    expect(res.kpis.pausedPlans).toBe(1);
    expect(res.statusCounts.COMPLETED).toBe(5);
    // Capture rate = 8 / (8 + 2) = 0.8; pending tracked separately.
    expect(res.kpis.captureRate).toBeCloseTo(0.8, 5);
    expect(res.kpis.capturePending).toBe(1);
    expect(res.kpis.collectedAllTime).toBeCloseTo(4032, 2);
    // The next due charge for each plan lands tomorrow → one forecast day holds
    // both charges (504 + 505 = 1009).
    expect(res.forecast).toHaveLength(14);
    expect(res.forecastCount).toBeGreaterThanOrEqual(2);
    expect(res.forecastTotal).toBeGreaterThanOrEqual(1009);
    expect(res.plans).toHaveLength(2);
    expect(res.frequencyMix[0]!.frequency).toBe("WEEKLY");
  });

  it("rejects callers without an admin session", async () => {
    const { ctx } = makeCtx({ role: null });
    await expect(
      adminRouter.createCaller(ctx).financeRecurring({}),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("admin.financeReconciliation", () => {
  it("delegates to the reconcile service, refreshing the mirror live outside production", async () => {
    reconcilePaymentsMock.mockResolvedValue({
      summary: { stripeNet: 147.5, bookNet: 147.5, variance: 0, matchedCount: 1, unmatchedCount: 0 },
      rows: [],
      unmatched: [],
    });
    const { ctx } = makeCtx();
    const res = await adminRouter.createCaller(ctx).financeReconciliation(range);
    expect(res.summary.variance).toBe(0);
    // NODE_ENV is "test" under vitest → not production → live refresh requested.
    expect(reconcilePaymentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ live: true }),
    );
  });

  it("rejects callers without an admin session", async () => {
    const { ctx } = makeCtx({ role: null });
    await expect(
      adminRouter.createCaller(ctx).financeReconciliation(range),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("admin.financeGst", () => {
  it("delegates to the payment-ledger GST summary for the requested window", async () => {
    computeGstSummaryMock.mockResolvedValue({
      totalRevenueInc: 165,
      totalRevenueEx: 150,
      gstCollected: 20,
      gstOnRefunds: 5,
      netGst: 15,
      byDepot: [],
    });
    const { ctx } = makeCtx();
    const res = await adminRouter.createCaller(ctx).financeGst({ ...range, depotId: "d1" });
    expect(res.netGst).toBe(15);
    expect(res.gstCollected - res.gstOnRefunds).toBeCloseTo(res.netGst, 2);
    expect(computeGstSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: range.from, to: range.to, depotId: "d1" }),
    );
  });

  it("rejects callers without an admin session", async () => {
    const { ctx } = makeCtx({ role: null });
    await expect(
      adminRouter.createCaller(ctx).financeGst(range),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("admin.refreshStripeReconcile", () => {
  it("runs the reconcile job and returns its result", async () => {
    runStripeReconcileMock.mockResolvedValue({ balanceTxnsProcessed: 3, unmatchedSystemLedger: 0 });
    const { ctx, prisma } = makeCtx();
    (prisma as Record<string, unknown>).auditLog = { create: vi.fn().mockResolvedValue({}) };
    const res = await adminRouter.createCaller(ctx).refreshStripeReconcile();
    expect(res.balanceTxnsProcessed).toBe(3);
    expect(runStripeReconcileMock).toHaveBeenCalled();
  });

  it("rejects callers without an admin session", async () => {
    const { ctx } = makeCtx({ role: null });
    await expect(
      adminRouter.createCaller(ctx).refreshStripeReconcile(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
