import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// recordBookingCompletion now delegates the customer-profile counters to the
// rewards recompute (net-collected spend / points / tier). Stub it so this
// stays a pure unit test of the DailyRevenue side.
const recomputeCustomerRewardsMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/customer-rewards", () => ({
  recomputeCustomerRewards: (...a: unknown[]) => recomputeCustomerRewardsMock(...a),
}));

import {
  applyRevenueDelta,
  recordBookingCompletion,
  recordAdditionalCharges,
  recordIncidentForCustomer,
  recordRefund,
} from "../../../src/server/services/revenue-aggregator";

function makeTx() {
  const dailyRevenueUpsert = vi.fn((_args: Record<string, unknown>) => Promise.resolve({}));
  const customerProfileUpdateMany = vi.fn((_args: Record<string, unknown>) =>
    Promise.resolve({ count: 1 }),
  );
  const tx = {
    dailyRevenue: { upsert: dailyRevenueUpsert },
    customerProfile: { updateMany: customerProfileUpdateMany },
  };
  return {
    tx: tx as unknown as Prisma.TransactionClient,
    dailyRevenueUpsert,
    customerProfileUpdateMany,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstUpsertCall(fn: ReturnType<typeof vi.fn>): any {
  return fn.mock.calls[0]![0];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstUpdateManyCall(fn: ReturnType<typeof vi.fn>): any {
  return fn.mock.calls[0]![0];
}

describe("applyRevenueDelta", () => {
  it("upserts on (date, depotId) with incremented values", async () => {
    const { tx, dailyRevenueUpsert } = makeTx();
    await applyRevenueDelta(tx, {
      date: new Date(Date.UTC(2026, 3, 18, 14, 30)),
      depotId: "depot-1",
      totalRevenue: 150,
      bookingRevenue: 100,
      addonRevenue: 50,
      totalGst: new Prisma.Decimal("13.64"),
    });
    expect(dailyRevenueUpsert).toHaveBeenCalledTimes(1);
    const call = firstUpsertCall(dailyRevenueUpsert);
    // date should be normalised to midnight UTC
    expect(call.where.date_depotId.depotId).toBe("depot-1");
    expect((call.where.date_depotId.date as Date).toISOString()).toBe("2026-04-18T00:00:00.000Z");
    expect(call.update.totalRevenue.increment.toString()).toBe("150");
    expect(call.update.bookingRevenue.increment.toString()).toBe("100");
    expect(call.update.totalGst.increment.toString()).toBe("13.64");
    // omitted fields default to 0
    expect(call.update.damageRevenue.increment.toString()).toBe("0");
  });
});

describe("recordBookingCompletion", () => {
  it("upserts DailyRevenue and recomputes the customer's rewards", async () => {
    recomputeCustomerRewardsMock.mockClear();
    const { tx, dailyRevenueUpsert } = makeTx();
    const when = new Date(Date.UTC(2026, 3, 18, 10));
    await recordBookingCompletion(tx, {
      id: "b-1",
      customerId: "user-1",
      depotId: "depot-2",
      actualReturnDateTime: when,
      subtotal: new Prisma.Decimal("120"),
      addonTotal: new Prisma.Decimal("15"),
      gstAmount: new Prisma.Decimal("12.27"),
      totalAmount: new Prisma.Decimal("135"),
    });

    expect(dailyRevenueUpsert).toHaveBeenCalledTimes(1);
    const rev = firstUpsertCall(dailyRevenueUpsert);
    expect(rev.where.date_depotId.depotId).toBe("depot-2");
    expect(rev.update.bookingRevenue.increment.toString()).toBe("120");
    expect(rev.update.addonRevenue.increment.toString()).toBe("15");
    expect(rev.update.totalRevenue.increment.toString()).toBe("135");
    expect(rev.update.netRevenue.increment.toString()).toBe("135");

    // Spend / bookings / points / tier are recomputed from source ledgers.
    expect(recomputeCustomerRewardsMock).toHaveBeenCalledTimes(1);
    expect(recomputeCustomerRewardsMock).toHaveBeenCalledWith(tx, "user-1");
  });

  it("falls back to now when actualReturnDateTime is null", async () => {
    const { tx, dailyRevenueUpsert } = makeTx();
    await recordBookingCompletion(tx, {
      id: "b-2",
      customerId: "user-2",
      depotId: "depot-3",
      actualReturnDateTime: null,
      subtotal: new Prisma.Decimal("10"),
      addonTotal: new Prisma.Decimal("0"),
      gstAmount: new Prisma.Decimal("0.91"),
      totalAmount: new Prisma.Decimal("10"),
    });
    expect(dailyRevenueUpsert).toHaveBeenCalledTimes(1);
    const rev = firstUpsertCall(dailyRevenueUpsert);
    expect(rev.where.date_depotId.date).toBeInstanceOf(Date);
  });
});

describe("recordAdditionalCharges", () => {
  it("adds damage + late + fuel into the correct buckets", async () => {
    const { tx, dailyRevenueUpsert } = makeTx();
    await recordAdditionalCharges(tx, {
      depotId: "depot-1",
      at: new Date("2026-04-18T00:00:00Z"),
      damageAmount: 200,
      lateFeeAmount: 50,
      fuelChargeAmount: 25,
    });
    expect(dailyRevenueUpsert).toHaveBeenCalledTimes(1);
    const call = firstUpsertCall(dailyRevenueUpsert);
    expect(call.update.damageRevenue.increment.toString()).toBe("200");
    expect(call.update.lateFeesRevenue.increment.toString()).toBe("75");
    expect(call.update.totalRevenue.increment.toString()).toBe("275");
  });

  it("is a no-op when all three deltas are zero", async () => {
    const { tx, dailyRevenueUpsert } = makeTx();
    await recordAdditionalCharges(tx, {
      depotId: "depot-1",
      at: new Date(),
      damageAmount: 0,
      lateFeeAmount: 0,
      fuelChargeAmount: 0,
    });
    expect(dailyRevenueUpsert).not.toHaveBeenCalled();
  });
});

describe("recordIncidentForCustomer", () => {
  it("increments incidentCount on the customer profile", async () => {
    const { tx, customerProfileUpdateMany } = makeTx();
    await recordIncidentForCustomer(tx, "user-42");
    expect(customerProfileUpdateMany).toHaveBeenCalledTimes(1);
    const call = firstUpdateManyCall(customerProfileUpdateMany);
    expect(call.where.userId).toBe("user-42");
    expect(call.data.incidentCount.increment).toBe(1);
  });

  it("is a no-op when customerId is null or undefined", async () => {
    const { tx, customerProfileUpdateMany } = makeTx();
    await recordIncidentForCustomer(tx, null);
    await recordIncidentForCustomer(tx, undefined);
    expect(customerProfileUpdateMany).not.toHaveBeenCalled();
  });
});

describe("recordRefund", () => {
  it("writes to totalRefunds and subtracts from netRevenue", async () => {
    const { tx, dailyRevenueUpsert } = makeTx();
    await recordRefund(tx, {
      depotId: "depot-1",
      at: new Date("2026-04-18T00:00:00Z"),
      amount: 80,
    });
    expect(dailyRevenueUpsert).toHaveBeenCalledTimes(1);
    const call = firstUpsertCall(dailyRevenueUpsert);
    expect(call.update.totalRefunds.increment.toString()).toBe("80");
    expect(call.update.netRevenue.increment.toString()).toBe("-80");
  });

  it("is a no-op for zero-amount refunds", async () => {
    const { tx, dailyRevenueUpsert } = makeTx();
    await recordRefund(tx, { depotId: "depot-1", at: new Date(), amount: 0 });
    expect(dailyRevenueUpsert).not.toHaveBeenCalled();
  });
});
