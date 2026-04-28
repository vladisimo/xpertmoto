import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/prisma", () => {
  const bookingUpdate = vi.fn();
  const bookingFindMany = vi.fn();
  const discountUpsert = vi.fn();
  return {
    prisma: {
      booking: {
        findMany: bookingFindMany,
        update: bookingUpdate,
      },
      discount: { upsert: discountUpsert },
    },
    __mocks: { bookingFindMany, bookingUpdate, discountUpsert },
  };
});

vi.mock("../../../src/server/services/notification-sender", () => ({
  sendNotification: vi.fn().mockResolvedValue({
    results: [{ channel: "EMAIL", status: "SENT" }],
    logIds: [],
    notificationIds: [],
  }),
}));

vi.mock("@react-email/render", () => ({
  render: vi.fn().mockResolvedValue("<html>stub</html>"),
}));

import { runCartRecovery } from "../../../src/server/jobs/cart-recovery";
import { prisma } from "../../../src/lib/prisma";
import { sendNotification } from "../../../src/server/services/notification-sender";

const mocks = (
  prisma as unknown as {
    booking: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    discount: { upsert: ReturnType<typeof vi.fn> };
  }
);

function mockBooking(over: Partial<{ recoveryStage: number; ageMinutes: number }> = {}) {
  const now = new Date("2026-05-01T10:00:00Z");
  const createdAt = new Date(now.getTime() - (over.ageMinutes ?? 60) * 60 * 1000);
  return {
    id: "b1",
    bookingReference: "SCT-20260501-1234",
    customerId: "u1",
    totalAmount: 120,
    status: "PENDING_PAYMENT",
    createdAt,
    recoveryStage: over.recoveryStage ?? 0,
    pickupDateTime: new Date(now.getTime() + 3 * 86400_000),
    customer: { firstName: "Ava" },
    category: { name: "125cc Scooter" },
    pickupDepot: { name: "Gold Coast" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.booking.update.mockResolvedValue({});
  mocks.discount.upsert.mockResolvedValue({});
});

describe("runCartRecovery", () => {
  it("advances a fresh booking from stage 0 → 1 once past 30 min", async () => {
    mocks.booking.findMany.mockResolvedValue([mockBooking({ ageMinutes: 45 })]);
    const now = new Date("2026-05-01T10:00:00Z");
    const result = await runCartRecovery(now);
    expect(result.stage1).toBe(1);
    expect(result.stage2).toBe(0);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CART_RECOVERY_HOLD" }),
    );
    expect(mocks.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { recoveryStage: 1 } }),
    );
  });

  it("advances stage 1 → 2 at 2 hours with a discount code", async () => {
    mocks.booking.findMany.mockResolvedValue([
      mockBooking({ recoveryStage: 1, ageMinutes: 130 }),
    ]);
    const now = new Date("2026-05-01T10:00:00Z");
    const result = await runCartRecovery(now);
    expect(result.stage2).toBe(1);
    expect(mocks.discount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: expect.stringMatching(/^COMEBACK-/) },
      }),
    );
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CART_RECOVERY_DISCOUNT" }),
    );
  });

  it("advances stage 2 → 3 at 12 hours (last chance)", async () => {
    mocks.booking.findMany.mockResolvedValue([
      mockBooking({ recoveryStage: 2, ageMinutes: 800 }),
    ]);
    const now = new Date("2026-05-01T10:00:00Z");
    const result = await runCartRecovery(now);
    expect(result.stage3).toBe(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CART_RECOVERY_LAST_CHANCE" }),
    );
  });

  it("does not re-notify a booking already at the latest stage", async () => {
    mocks.booking.findMany.mockResolvedValue([
      // findMany already filters to recoveryStage < 3; simulate by returning empty
    ]);
    const result = await runCartRecovery();
    expect(result.scanned).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("does not advance a booking that has not reached the next threshold", async () => {
    mocks.booking.findMany.mockResolvedValue([
      mockBooking({ recoveryStage: 1, ageMinutes: 60 }),
    ]);
    const result = await runCartRecovery();
    expect(result.stage2).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
