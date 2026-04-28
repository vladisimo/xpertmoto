import { describe, expect, it } from "vitest";
import {
  debtorsList,
  incidentsSummary,
  unpaidInfringementsSummary,
  type PrismaLike,
} from "../../../src/server/services/admin-risk-signals";

function mockDb(overrides: Record<string, unknown>): PrismaLike {
  return {
    incident: { findMany: async () => [], count: async () => 0 },
    infringement: { groupBy: async () => [] },
    invoice: { groupBy: async () => [] },
    booking: { groupBy: async () => [] },
    vehicle: { findMany: async () => [] },
    user: { findMany: async () => [] },
    notification: { findMany: async () => [] },
    ...overrides,
  } as unknown as PrismaLike;
}

describe("unpaidInfringementsSummary", () => {
  it("aggregates totals and per-type breakdown", async () => {
    const db = mockDb({
      infringement: {
        groupBy: async () => [
          { type: "TOLL", _count: 3, _sum: { amount: 45 } },
          { type: "SPEEDING", _count: 1, _sum: { amount: 200 } },
        ],
      },
    });
    const res = await unpaidInfringementsSummary(db);
    expect(res.totalAmount).toBe(245);
    expect(res.totalCount).toBe(4);
    expect(res.byType).toHaveLength(2);
  });
});

describe("debtorsList", () => {
  it("sums booking + invoice + infringement debt per customer", async () => {
    const db = mockDb({
      booking: {
        groupBy: async () => [{ customerId: "u1", _sum: { balanceDue: 120 } }],
      },
      invoice: {
        groupBy: async () => [{ customerId: "u1", _sum: { totalAmount: 80 } }],
      },
      infringement: {
        groupBy: async () => [{ customerId: "u1", _sum: { amount: 50 } }],
      },
      user: {
        findMany: async () => [
          { id: "u1", firstName: "Jess", lastName: "Ng", email: "j@example.com", phone: "+614" },
        ],
      },
      notification: { findMany: async () => [] },
    });
    const res = await debtorsList(100, db);
    expect(res).toHaveLength(1);
    expect(res[0]?.totalOwed).toBe(250);
    expect(res[0]?.bookingDebt).toBe(120);
    expect(res[0]?.invoiceDebt).toBe(80);
    expect(res[0]?.infringementDebt).toBe(50);
    expect(res[0]?.lastReminderAt).toBeNull();
  });

  it("joins most recent DEBT_REMINDER notification", async () => {
    const sentAt = new Date("2026-04-10T00:00:00Z");
    const earlier = new Date("2026-04-01T00:00:00Z");
    const db = mockDb({
      booking: {
        groupBy: async () => [{ customerId: "u2", _sum: { balanceDue: 100 } }],
      },
      user: {
        findMany: async () => [
          { id: "u2", firstName: "Ava", lastName: "Lee", email: "a@ex.com", phone: null },
        ],
      },
      notification: {
        findMany: async () => [
          { userId: "u2", createdAt: sentAt },
          { userId: "u2", createdAt: earlier },
        ],
      },
    });
    const res = await debtorsList(100, db);
    expect(res[0]?.lastReminderAt).toEqual(sentAt);
  });

  it("sorts highest owed first and filters zero balances", async () => {
    const db = mockDb({
      booking: {
        groupBy: async () => [
          { customerId: "u-small", _sum: { balanceDue: 10 } },
          { customerId: "u-big", _sum: { balanceDue: 500 } },
          { customerId: "u-zero", _sum: { balanceDue: 0 } },
        ],
      },
      user: {
        findMany: async () => [
          { id: "u-small", firstName: "S", lastName: "m", email: "s@e", phone: null },
          { id: "u-big", firstName: "B", lastName: "g", email: "b@e", phone: null },
          { id: "u-zero", firstName: "Z", lastName: "o", email: "z@e", phone: null },
        ],
      },
    });
    const res = await debtorsList(100, db);
    expect(res.map((d) => d.customerId)).toEqual(["u-big", "u-small"]);
  });
});

describe("incidentsSummary", () => {
  it("buckets incidents into 12 months by severity", async () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 15);
    const db = mockDb({
      incident: {
        findMany: async (args: { where?: { dateTime?: { gte?: Date } } }) => {
          const since = args.where?.dateTime?.gte;
          if (!since) return [];
          // Distinguish MTD (startOfMonth) from 12-month trend calls by the
          // cut-off date: MTD uses the 1st of this month, trend uses ~12 months back.
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          if (since.getTime() === startOfMonth.getTime()) {
            return [{ type: "ACCIDENT", severity: "MINOR" }];
          }
          return [
            { dateTime: thisMonth, severity: "MINOR" },
            { dateTime: twoMonthsAgo, severity: "MAJOR" },
          ];
        },
        count: async () => 2,
      },
    });
    const res = await incidentsSummary(db);
    expect(res.mtd.total).toBe(1);
    expect(res.openTheft).toBe(2);
    expect(res.trend12m).toHaveLength(12);
    const withData = res.trend12m.filter(
      (m) => m.minor + m.moderate + m.major + m.totalLoss > 0,
    );
    expect(withData.length).toBe(2);
  });
});
