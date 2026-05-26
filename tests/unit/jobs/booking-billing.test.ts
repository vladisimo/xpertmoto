import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    bookingBillingPlan: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      create: vi.fn(),
    },
    booking: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { runBookingBilling } from "../../../src/server/jobs/booking-billing";
import { prisma } from "../../../src/lib/prisma";

type MockFn = ReturnType<typeof vi.fn>;
const mockedFindMany = prisma.bookingBillingPlan.findMany as unknown as MockFn;
const mockedUpdate = prisma.bookingBillingPlan.update as unknown as MockFn;
const mockedPaymentCreate = prisma.payment.create as unknown as MockFn;
const mockedBookingUpdate = prisma.booking.update as unknown as MockFn;
const mockedTx = prisma.$transaction as unknown as MockFn;

function makePlan(overrides: Partial<{
  id: string;
  bookingId: string;
  periodsTotal: number;
  periodsCompleted: number;
  nextChargeAt: Date;
  amountPerPeriod: number;
  gstPerPeriod: number;
  frequency: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
  bookingStatus: string;
  bookingReturn: Date;
}> = {}) {
  return {
    id: overrides.id ?? "plan1",
    bookingId: overrides.bookingId ?? "bk1",
    frequency: overrides.frequency ?? "WEEKLY",
    amountPerPeriod: overrides.amountPerPeriod ?? 504,
    gstPerPeriod: overrides.gstPerPeriod ?? 45.82,
    periodsTotal: overrides.periodsTotal ?? 3,
    periodsCompleted: overrides.periodsCompleted ?? 0,
    nextChargeAt: overrides.nextChargeAt ?? new Date("2026-04-17T10:00:00Z"),
    lastChargedAt: null,
    chargesAttempted: 0,
    chargesSucceeded: 0,
    chargesFailed: 0,
    status: "ACTIVE",
    booking: {
      id: overrides.bookingId ?? "bk1",
      bookingReference: "SCT-TEST-0001",
      customerId: "cust1",
      returnDateTime:
        overrides.bookingReturn ?? new Date("2026-05-08T10:00:00Z"),
      status: overrides.bookingStatus ?? "ACTIVE",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: $transaction immediately invokes its callback with a tx-like
  // object that points at the same mocks, so the production code path runs
  // through unchanged.
  mockedTx.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
    fn(prisma),
  );
});

describe("runBookingBilling", () => {
  it("does nothing when no plans are due", async () => {
    mockedFindMany.mockResolvedValue([]);
    const res = await runBookingBilling({ now: new Date("2026-04-17T11:00:00Z") });
    expect(res).toEqual({ scanned: 0, charged: 0, completed: 0, skipped: 0 });
    expect(mockedPaymentCreate).not.toHaveBeenCalled();
  });

  it("queues a SUBSCRIPTION_CHARGE and advances nextChargeAt by one period", async () => {
    const plan = makePlan();
    mockedFindMany.mockResolvedValue([plan]);
    const now = new Date("2026-04-17T11:00:00Z");
    const res = await runBookingBilling({ now });

    expect(res.scanned).toBe(1);
    expect(res.charged).toBe(1);
    expect(mockedPaymentCreate).toHaveBeenCalledOnce();
    const paymentArgs = mockedPaymentCreate.mock.calls[0]![0];
    expect(paymentArgs.data.type).toBe("SUBSCRIPTION_CHARGE");
    expect(paymentArgs.data.status).toBe("PENDING");
    expect(paymentArgs.data.amount).toBe(504);
    expect(paymentArgs.data.bookingId).toBe("bk1");
    expect(paymentArgs.data.reference).toMatch(/^BOOKING-BILLING-plan1-1$/);

    // Plan advanced: nextChargeAt + 7 days, periodsCompleted = 1.
    const updateArgs = mockedUpdate.mock.calls[0]![0];
    expect(updateArgs.where.id).toBe("plan1");
    expect(updateArgs.data.periodsCompleted).toBe(1);
    expect(updateArgs.data.status).toBe("ACTIVE");
    const expectedNext = new Date("2026-04-24T10:00:00Z");
    expect(new Date(updateArgs.data.nextChargeAt).toISOString()).toBe(
      expectedNext.toISOString(),
    );
  });

  it("never touches Booking.balanceDue when enqueuing a charge (F2 regression)", async () => {
    // The full recurring balance is pre-loaded into balanceDue at confirmation;
    // this job must only create the PENDING Payment and advance the plan.
    // Incrementing balanceDue here would double-count — applyCaptureToBalanceDue
    // is the sole place the recurring balance is netted out, on capture.
    const plan = makePlan();
    mockedFindMany.mockResolvedValue([plan]);
    await runBookingBilling({ now: new Date("2026-04-17T11:00:00Z") });

    expect(mockedPaymentCreate).toHaveBeenCalledOnce();
    expect(mockedBookingUpdate).not.toHaveBeenCalled();
  });

  it("marks the plan COMPLETED after the last recurring period fires", async () => {
    const plan = makePlan({ periodsTotal: 2, periodsCompleted: 1 });
    mockedFindMany.mockResolvedValue([plan]);
    await runBookingBilling({ now: new Date("2026-04-17T11:00:00Z") });

    const updateArgs = mockedUpdate.mock.calls[0]![0];
    expect(updateArgs.data.periodsCompleted).toBe(2);
    expect(updateArgs.data.status).toBe("COMPLETED");
  });

  it("closes an ACTIVE plan early if the booking is already CANCELLED", async () => {
    const plan = makePlan({ bookingStatus: "CANCELLED" });
    mockedFindMany.mockResolvedValue([plan]);
    const res = await runBookingBilling({ now: new Date("2026-04-17T11:00:00Z") });

    expect(res.completed).toBe(1);
    expect(res.charged).toBe(0);
    expect(mockedPaymentCreate).not.toHaveBeenCalled();
    expect(mockedUpdate.mock.calls[0]![0].data.status).toBe("COMPLETED");
  });

  it("closes an ACTIVE plan when the booking's returnDateTime has already passed", async () => {
    const plan = makePlan({
      bookingReturn: new Date("2026-04-17T09:00:00Z"), // already past
    });
    mockedFindMany.mockResolvedValue([plan]);
    const res = await runBookingBilling({ now: new Date("2026-04-17T11:00:00Z") });

    expect(res.completed).toBe(1);
    expect(res.charged).toBe(0);
  });

  it("fortnightly frequency advances nextChargeAt by 14 days", async () => {
    const plan = makePlan({ frequency: "FORTNIGHTLY" });
    mockedFindMany.mockResolvedValue([plan]);
    await runBookingBilling({ now: new Date("2026-04-17T11:00:00Z") });

    const updateArgs = mockedUpdate.mock.calls[0]![0];
    const expectedNext = new Date("2026-05-01T10:00:00Z");
    expect(new Date(updateArgs.data.nextChargeAt).toISOString()).toBe(
      expectedNext.toISOString(),
    );
  });

  it("monthly frequency advances nextChargeAt by 30 days", async () => {
    const plan = makePlan({ frequency: "MONTHLY" });
    mockedFindMany.mockResolvedValue([plan]);
    await runBookingBilling({ now: new Date("2026-04-17T11:00:00Z") });

    const updateArgs = mockedUpdate.mock.calls[0]![0];
    const expectedNext = new Date("2026-05-17T10:00:00Z");
    expect(new Date(updateArgs.data.nextChargeAt).toISOString()).toBe(
      expectedNext.toISOString(),
    );
  });
});
