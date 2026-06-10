import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("../../../src/lib/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(24),
  SETTING_DEFAULTS: { "booking.pendingPaymentTimeoutHours": 24 },
}));
const confirmMock = vi.fn();
vi.mock("../../../src/server/services/booking-confirmation", () => ({
  confirmBookingPayment: (...a: unknown[]) => confirmMock(...a),
}));

import { runPendingPaymentTtl } from "../../../src/server/jobs/pending-payment-ttl";
import { prisma } from "../../../src/lib/prisma";

type MockFn = ReturnType<typeof vi.fn>;
const mockedFindMany = prisma.booking.findMany as unknown as MockFn;
const mockedUpdate = prisma.booking.update as unknown as MockFn;

function makeCandidate(overrides: Partial<{
  id: string;
  status: string;
  payments: Array<{ id: string; stripePaymentIntentId: string | null }>;
}> = {}) {
  return {
    id: overrides.id ?? "b1",
    status: overrides.status ?? "PENDING_PAYMENT",
    bookingReference: "XPM-20260610-0001",
    vehicleId: null,
    payments: overrides.payments ?? [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUpdate.mockResolvedValue({});
  confirmMock.mockResolvedValue({ booking: { id: "b1" }, alreadyConfirmed: false });
});

describe("pending-payment TTL sweep", () => {
  it("cancels a stale unpaid booking", async () => {
    mockedFindMany.mockResolvedValue([makeCandidate()]);

    const res = await runPendingPaymentTtl();

    expect(res).toEqual({ scanned: 1, cancelled: 1, recovered: 0 });
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b1" },
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("confirms — never cancels — a stale booking that was already PAID", async () => {
    mockedFindMany.mockResolvedValue([
      makeCandidate({
        payments: [{ id: "pay1", stripePaymentIntentId: "pi_1" }],
      }),
    ]);

    const res = await runPendingPaymentTtl();

    expect(res).toEqual({ scanned: 1, cancelled: 0, recovered: 1 });
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingId: "b1",
        paymentIntentId: "pi_1",
        source: "ttl-sweep",
      }),
    );
  });

  it("leaves a paid booking alone (no cancel) when the confirm rescue fails", async () => {
    confirmMock.mockRejectedValue(new Error("no vehicles left"));
    mockedFindMany.mockResolvedValue([
      makeCandidate({
        payments: [{ id: "pay1", stripePaymentIntentId: "pi_1" }],
      }),
    ]);

    const res = await runPendingPaymentTtl();

    expect(res).toEqual({ scanned: 1, cancelled: 0, recovered: 0 });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("only treats SUCCEEDED booking payments as paid — the query filters at the DB", async () => {
    mockedFindMany.mockResolvedValue([]);

    await runPendingPaymentTtl();

    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          payments: expect.objectContaining({
            where: { type: "BOOKING_PAYMENT", status: "SUCCEEDED" },
          }),
        }),
      }),
    );
  });
});
