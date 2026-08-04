import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Overdue auto-billing: each COMPLETED 24h block past grace raises one
 * daily-rate LATE_FEE (`LATE-<bookingId>-D<n>`) + balanceDue increment, so a
 * bike kept out for days accrues money without staff running a return
 * assessment. Deterministic references make the 15-minute re-runs collide
 * (P2002) instead of double-billing, and accrual stops at the 7-day cap.
 */

const bookingFindMany = vi.fn();
const bookingUpdate = vi.fn().mockResolvedValue({});
const paymentCreate = vi.fn().mockResolvedValue({});
const statusLogCreate = vi.fn().mockResolvedValue({});
const noteCreate = vi.fn().mockResolvedValue({});
const userFindMany = vi.fn().mockResolvedValue([]);
const txFn = vi.fn(async (cb: (tx: unknown) => unknown) =>
  cb({
    payment: { create: paymentCreate },
    booking: { update: bookingUpdate },
    bookingStatusLog: { create: statusLogCreate },
    bookingNote: { create: noteCreate },
    incident: { create: vi.fn() },
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: { findMany: bookingFindMany, update: bookingUpdate },
    payment: { create: paymentCreate },
    user: { findMany: userFindMany },
    $transaction: txFn,
  },
}));
vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({ siteName: "XPERT Moto" }),
}));
vi.mock("@react-email/render", () => ({ render: vi.fn().mockResolvedValue("<html/>") }));
vi.mock("@/lib/analytics", () => ({ trackServer: vi.fn() }));
vi.mock("@/server/services/revenue-aggregator", () => ({
  recordIncidentForCustomer: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ "booking.lateReturnGraceHours": 1 }),
  SETTING_DEFAULTS: { "booking.lateReturnGraceHours": 1 },
}));
vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn().mockReturnValue(null),
  registerWorker: vi.fn(),
  monitorCron: vi.fn(),
}));

const HOUR = 60 * 60 * 1000;

function makeBooking(hoursLate: number, over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    bookingReference: "SCT-0001",
    customerId: "cust_1",
    status: "OVERDUE",
    overdueStage: 4, // stages already exhausted — isolates the accrual logic
    returnDateTime: new Date(Date.now() - hoursLate * HOUR),
    customer: {
      id: "cust_1",
      email: "c@x.co",
      firstName: "C",
      lastName: "X",
      phone: null,
    },
    category: { baseDailyRate: "89.00" },
    vehicle: null,
    pickupDepotId: "depot_1",
    pickupDepot: { slug: "gc" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindMany.mockResolvedValue([]);
});

describe("overdue-check late-day fee accrual", () => {
  it("raises one daily-rate LATE_FEE per completed late day with deterministic refs", async () => {
    // grace 1h + 2 completed days + part of a third (2*24 + 1 + 3 = 52h late)
    bookingFindMany.mockResolvedValue([makeBooking(52)]);
    const { runOverdueCheck } = await import("@/server/jobs/overdue-check");
    await runOverdueCheck();

    const lateCreates = paymentCreate.mock.calls.filter(
      (c) => (c[0] as { data: { type: string } }).data.type === "LATE_FEE",
    );
    expect(lateCreates.map((c) => (c[0] as { data: { reference: string } }).data.reference)).toEqual([
      "LATE-b1-D1",
      "LATE-b1-D2",
    ]);
    expect((lateCreates[0]![0] as { data: { amount: number } }).data.amount).toBe(89);
    // Each raise pairs with a balanceDue increment (raise→add contract).
    const incs = bookingUpdate.mock.calls.filter(
      (c) =>
        (c[0] as { data?: { balanceDue?: { increment?: number } } }).data?.balanceDue
          ?.increment === 89,
    );
    expect(incs.length).toBe(2);
  });

  it("raises nothing inside the first late day", async () => {
    bookingFindMany.mockResolvedValue([makeBooking(20)]); // < grace + 24h
    const { runOverdueCheck } = await import("@/server/jobs/overdue-check");
    await runOverdueCheck();
    const lateCreates = paymentCreate.mock.calls.filter(
      (c) => (c[0] as { data: { type: string } }).data.type === "LATE_FEE",
    );
    expect(lateCreates.length).toBe(0);
  });

  it("skips already-raised days via the unique-reference collision", async () => {
    bookingFindMany.mockResolvedValue([makeBooking(52)]);
    const { Prisma } = await import("@prisma/client");
    paymentCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "5",
      }),
    );
    const { runOverdueCheck } = await import("@/server/jobs/overdue-check");
    const r = await runOverdueCheck();
    expect(r.scanned).toBe(1);
    // Day 1 collided (already raised on a prior tick); day 2 still raised.
    const lateCreates = paymentCreate.mock.calls.filter(
      (c) => (c[0] as { data: { type: string } }).data.type === "LATE_FEE",
    );
    expect(lateCreates.length).toBe(2); // both attempted…
    const incs = bookingUpdate.mock.calls.filter(
      (c) =>
        (c[0] as { data?: { balanceDue?: { increment?: number } } }).data?.balanceDue
          ?.increment === 89,
    );
    expect(incs.length).toBe(1); // …but only the fresh one paired an increment
  });

  it("caps auto-accrual at 7 days", async () => {
    bookingFindMany.mockResolvedValue([makeBooking(24 * 30)]); // a month late
    const { runOverdueCheck } = await import("@/server/jobs/overdue-check");
    await runOverdueCheck();
    const lateCreates = paymentCreate.mock.calls.filter(
      (c) => (c[0] as { data: { type: string } }).data.type === "LATE_FEE",
    );
    expect(lateCreates.length).toBe(7);
  });
});
