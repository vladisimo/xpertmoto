import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const { queryRaw, dailyRevenueUpsert } = vi.hoisted(() => ({
  queryRaw: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  dailyRevenueUpsert: vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    $queryRaw: queryRaw,
    dailyRevenue: {
      upsert: dailyRevenueUpsert,
      // Clobber-fix reads existing live deltas before rebuilding totals.
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../../../src/lib/cache", () => ({
  invalidateTag: vi.fn(async () => undefined),
}));

vi.mock("../../../src/lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn() }) },
}));

vi.mock("../../../src/server/jobs/queue", () => ({
  registerWorker: vi.fn(),
  getQueue: vi.fn(() => null),
}));

import { reconcileDailyRevenue } from "../../../src/server/jobs/revenue-reconcile";

beforeEach(() => {
  queryRaw.mockReset();
  dailyRevenueUpsert.mockReset();
});

describe("reconcileDailyRevenue", () => {
  it("upserts one DailyRevenue row per (date, depot) returned by the raw query", async () => {
    queryRaw.mockResolvedValueOnce([
      {
        date: new Date("2026-04-17T00:00:00Z"),
        depotId: "depot-a",
        bookingRevenue: new Prisma.Decimal("200"),
        addonRevenue: new Prisma.Decimal("10"),
        gstAmount: new Prisma.Decimal("19.09"),
        totalAmount: new Prisma.Decimal("210"),
      },
      {
        date: new Date("2026-04-17T00:00:00Z"),
        depotId: "depot-b",
        bookingRevenue: new Prisma.Decimal("50"),
        addonRevenue: new Prisma.Decimal("0"),
        gstAmount: new Prisma.Decimal("4.55"),
        totalAmount: new Prisma.Decimal("50"),
      },
    ]);

    const written = await reconcileDailyRevenue({ fromDaysAgo: 1, toDaysAgo: 0 });

    expect(written).toBe(2);
    expect(dailyRevenueUpsert).toHaveBeenCalledTimes(2);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = dailyRevenueUpsert.mock.calls[0]![0] as any;
    expect(first.where.date_depotId.depotId).toBe("depot-a");
    // Full recompute: `update` is absolute (not increment)
    expect(first.update.totalRevenue.toString()).toBe("210");
    expect(first.update.netRevenue.toString()).toBe("210");
    expect(first.update.totalGst.toString()).toBe("19.09");
    expect(first.create.depotId).toBe("depot-a");
  });

  it("returns zero and does no upserts when the window is empty", async () => {
    queryRaw.mockResolvedValueOnce([]);
    const written = await reconcileDailyRevenue();
    expect(written).toBe(0);
    expect(dailyRevenueUpsert).not.toHaveBeenCalled();
  });
});
