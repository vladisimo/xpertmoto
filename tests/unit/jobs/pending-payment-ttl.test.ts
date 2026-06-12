import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
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
const sendNotificationMock = vi.fn();
vi.mock("../../../src/server/services/notification-sender", () => ({
  sendNotification: (...a: unknown[]) => sendNotificationMock(...a),
}));
const captureExceptionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureExceptionMock(...a),
}));

import { runPendingPaymentTtl } from "../../../src/server/jobs/pending-payment-ttl";
import { prisma } from "../../../src/lib/prisma";

type MockFn = ReturnType<typeof vi.fn>;
const mockedFindMany = prisma.booking.findMany as unknown as MockFn;
const mockedUpdate = prisma.booking.update as unknown as MockFn;
const mockedUserFindMany = prisma.user.findMany as unknown as MockFn;

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
    mockedUserFindMany.mockResolvedValue([{ id: "admin1" }, { id: "admin2" }]);
    mockedFindMany.mockResolvedValue([
      makeCandidate({
        payments: [{ id: "pay1", stripePaymentIntentId: "pi_1" }],
      }),
    ]);

    const res = await runPendingPaymentTtl();

    expect(res).toEqual({ scanned: 1, cancelled: 0, recovered: 0 });
    expect(mockedUpdate).not.toHaveBeenCalled();
    // The failure must escalate to humans — Sentry + one alert per admin —
    // not just re-log every night forever.
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin1",
        bookingId: "b1",
        dedupKey: expect.stringContaining("pending-ttl-rescue-failed:b1:"),
      }),
    );
  });

  it("keeps sweeping remaining bookings when the manager alert itself fails", async () => {
    confirmMock.mockRejectedValue(new Error("kaput"));
    mockedUserFindMany.mockRejectedValue(new Error("db sad"));
    mockedFindMany.mockResolvedValue([
      makeCandidate({ payments: [{ id: "pay1", stripePaymentIntentId: "pi_1" }] }),
      makeCandidate({ id: "b2" }),
    ]);

    const res = await runPendingPaymentTtl();

    // b1's alert failed quietly; b2 still got cancelled.
    expect(res).toEqual({ scanned: 2, cancelled: 1, recovered: 0 });
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
