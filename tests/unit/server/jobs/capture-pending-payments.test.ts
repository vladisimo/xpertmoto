import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted handles so the loop-driving tests can configure prisma / Stripe /
// the charge-settle + infringement helpers that the job pulls in at import.
const h = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  charge: vi.fn(),
  applyCaptureToBalanceDue: vi.fn(),
  markInfringementPaidOnCapture: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/server/services/stripe-customer", () => ({ chargeOffSessionForUser: h.charge }));
vi.mock("@/server/services/balance-due", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/balance-due")>()),
  applyCaptureToBalanceDue: h.applyCaptureToBalanceDue,
}));
vi.mock("@/server/services/infringement-charge", () => ({
  markInfringementPaidOnCapture: h.markInfringementPaidOnCapture,
}));
vi.mock("@/server/services/audit-payment", () => ({ writePaymentAudit: vi.fn() }));
vi.mock("@/server/services/payment-events", () => ({ writePaymentEvent: vi.fn() }));
vi.mock("@/server/services/notification-sender", () => ({ sendNotification: vi.fn() }));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({ siteName: "XPERT" }),
}));
vi.mock("@/lib/analytics", () => ({ trackServer: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, cb: (s: unknown) => unknown) => cb({ setAttributes: vi.fn() }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn(),
  registerWorker: vi.fn(),
  monitorCron: vi.fn(),
}));

import {
  runCapturePendingPayments,
  refreshSkipNote,
  NO_PM_SKIP_MARKER,
} from "@/server/jobs/capture-pending-payments";

const skipLines = (notes: string) =>
  notes.split("\n").filter((l) => l.includes(NO_PM_SKIP_MARKER)).length;

describe("refreshSkipNote", () => {
  it("seeds a single stamped skip line on empty notes", () => {
    const out = refreshSkipNote(null);
    expect(skipLines(out)).toBe(1);
    expect(out).toMatch(/^\[.+Z\] capture-pending: skipped/);
  });

  it("never stacks more than one skip line across repeated ticks", () => {
    let notes = refreshSkipNote(null);
    for (let i = 0; i < 50; i++) notes = refreshSkipNote(notes);
    expect(skipLines(notes)).toBe(1);
    expect(notes.split("\n")).toHaveLength(1);
  });

  it("preserves non-skip lines and drops only stale skip lines", () => {
    const existing =
      "[2026-05-11T02:05:00.000Z] capture-pending: skipped — no stored PM\n" +
      "[2026-05-11T02:10:00.000Z] capture-pending: requires_action — 3DS needed\n" +
      "[2026-05-11T02:15:00.000Z] capture-pending: skipped — no stored PM";
    const out = refreshSkipNote(existing);
    expect(skipLines(out)).toBe(1);
    expect(out).toContain("requires_action — 3DS needed");
    // the fresh skip line is appended last
    expect(out.split("\n").pop()).toContain(NO_PM_SKIP_MARKER);
  });
});

// --- capture loop: INFRINGEMENT_RECOVERY (toll) branches --------------------

const TOLL_ROW = {
  id: "pay_1",
  reference: "INFR-hash_abc",
  customerId: "cust_1",
  bookingId: "bk_1",
  type: "INFRINGEMENT_RECOVERY",
  amount: 13.29,
  notes: null,
  booking: { bookingReference: "XM-1001", pickupDepot: { slug: "bne" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(h.prisma, {
    payment: {
      findMany: vi.fn().mockResolvedValue([{ ...TOLL_ROW }]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(h.prisma)),
  });
});

describe("runCapturePendingPayments — INFRINGEMENT_RECOVERY", () => {
  it("captures a toll off-session, settles balanceDue, and flips the Infringement to PAID", async () => {
    h.charge.mockResolvedValue({ status: "succeeded", id: "pi_1", chargeId: "ch_1" });

    const res = await runCapturePendingPayments({ graceSeconds: 0 });

    expect(res.succeeded).toBe(1);
    // off-session charge against the saved card
    expect(h.charge).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "cust_1", amount: 13.29 }),
    );
    // Payment flipped SUCCEEDED under a CAS-on-PENDING guard
    const pay = h.prisma.payment as { updateMany: ReturnType<typeof vi.fn> };
    expect(pay.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay_1", status: "PENDING" },
        data: expect.objectContaining({ status: "SUCCEEDED", stripePaymentIntentId: "pi_1" }),
      }),
    );
    // collected → balanceDue settled + Infringement → PAID
    expect(h.applyCaptureToBalanceDue).toHaveBeenCalledTimes(1);
    expect(h.markInfringementPaidOnCapture).toHaveBeenCalledWith(h.prisma, "INFR-hash_abc");
  });

  it("marks the Payment FAILED on a hard decline and leaves balanceDue raised (still owed)", async () => {
    h.charge.mockResolvedValue({ status: "failed", id: "pi_2", errorCode: "card_declined" });

    const res = await runCapturePendingPayments({ graceSeconds: 0 });

    expect(res.failed).toBe(1);
    const pay = h.prisma.payment as { update: ReturnType<typeof vi.fn> };
    expect(pay.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay_1" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    // debt stays outstanding — no settle, Infringement not marked paid
    expect(h.applyCaptureToBalanceDue).not.toHaveBeenCalled();
    expect(h.markInfringementPaidOnCapture).not.toHaveBeenCalled();
  });

  it("only scans balance-affecting ancillary types with a stored customer and no prior intent", async () => {
    h.charge.mockResolvedValue({ status: "succeeded", id: "pi_1", chargeId: "ch_1" });

    await runCapturePendingPayments({ graceSeconds: 0 });

    const findMany = (h.prisma.payment as { findMany: ReturnType<typeof vi.fn> }).findMany;
    const where = findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      status: "PENDING",
      stripePaymentIntentId: null,
      customerId: { not: null },
    });
    expect(where.type.in).toContain("INFRINGEMENT_RECOVERY");
  });
});
