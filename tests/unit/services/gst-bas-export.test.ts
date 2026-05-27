import { describe, expect, test, it, vi, beforeEach } from "vitest";

const findManyPayment = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: { findMany: (...a: unknown[]) => findManyPayment(...a) },
  },
}));

import {
  computeGstSummary,
  generateBasCsv,
  quarterBoundaries,
} from "@/server/services/gst-bas-export";

describe("quarterBoundaries", () => {
  test("Q1 of 2026 = Jan-Mar", () => {
    const { from, to, label } = quarterBoundaries(2026, 1);
    expect(from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(label).toBe("2026-Q1");
  });

  test("Q2 of 2026 = Apr-Jun", () => {
    const { from, to } = quarterBoundaries(2026, 2);
    expect(from.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  test("Q3 of 2026 = Jul-Sep", () => {
    const { from, to } = quarterBoundaries(2026, 3);
    expect(from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  test("Q4 of 2026 = Oct-Dec (and spills into next year)", () => {
    const { from, to } = quarterBoundaries(2026, 4);
    expect(from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

const range = { from: new Date("2026-04-01"), to: new Date("2026-06-30T23:59:59.999Z") };

function payment(over: Record<string, unknown>) {
  return {
    type: "BOOKING_PAYMENT",
    amount: 0,
    gstAmount: 0,
    booking: { depotId: "d1", depot: { name: "Brisbane" } },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeGstSummary", () => {
  it("nets a refund's GST against collected GST", async () => {
    findManyPayment.mockResolvedValue([
      payment({ type: "BOOKING_PAYMENT", amount: 220, gstAmount: 20 }),
      payment({ type: "REFUND", amount: 55, gstAmount: 5 }),
    ]);

    const s = await computeGstSummary(range);

    expect(s.gstCollected).toBeCloseTo(20, 2);
    expect(s.gstOnRefunds).toBeCloseTo(5, 2);
    expect(s.netGst).toBeCloseTo(15, 2);
    expect(s.totalRevenueInc).toBeCloseTo(165, 2); // 220 − 55
    expect(s.totalRevenueEx).toBeCloseTo(150, 2); // 165 − 15
  });

  it("counts the full GST on an original charge that has since been partially refunded", async () => {
    // The original charge row now carries status PARTIALLY_REFUNDED but is still
    // in the settled set; its full GST must count, with the REFUND netting back.
    findManyPayment.mockResolvedValue([
      payment({ type: "BOOKING_PAYMENT", amount: 220, gstAmount: 20 }),
      payment({ type: "REFUND", amount: 110, gstAmount: 10 }),
    ]);

    const s = await computeGstSummary(range);

    expect(s.gstCollected).toBeCloseTo(20, 2);
    expect(s.netGst).toBeCloseTo(10, 2);
  });

  it("excludes bond holds and releases (non-cash authorisations)", async () => {
    findManyPayment.mockResolvedValue([
      payment({ type: "BOOKING_PAYMENT", amount: 220, gstAmount: 20 }),
      payment({ type: "BOND_HOLD", amount: 300, gstAmount: 0 }),
      payment({ type: "BOND_RELEASE", amount: 300, gstAmount: 0 }),
    ]);

    const s = await computeGstSummary(range);

    expect(s.totalRevenueInc).toBeCloseTo(220, 2);
    expect(s.gstCollected).toBeCloseTo(20, 2);
    expect(s.byDepot).toHaveLength(1);
  });

  it("groups by depot and buckets booking-less payments under Unassigned", async () => {
    findManyPayment.mockResolvedValue([
      payment({ type: "BOOKING_PAYMENT", amount: 220, gstAmount: 20, booking: { depotId: "d1", depot: { name: "Brisbane" } } }),
      payment({ type: "BOOKING_PAYMENT", amount: 110, gstAmount: 10, booking: { depotId: "d2", depot: { name: "Gold Coast" } } }),
      payment({ type: "MANUAL_CHARGE", amount: 11, gstAmount: 1, booking: null }),
    ]);

    const s = await computeGstSummary(range);

    expect(s.byDepot).toHaveLength(3);
    const unassigned = s.byDepot.find((d) => d.depotName === "Unassigned");
    expect(unassigned?.revenue).toBeCloseTo(11, 2);
    expect(unassigned?.gst).toBeCloseTo(1, 2);
    expect(s.gstCollected).toBeCloseTo(31, 2);
  });
});

describe("generateBasCsv", () => {
  it("renders G1 (total sales) and 1A (net GST) from the payment ledger", async () => {
    findManyPayment.mockResolvedValue([
      payment({ type: "BOOKING_PAYMENT", amount: 220, gstAmount: 20 }),
      payment({ type: "REFUND", amount: 55, gstAmount: 5 }),
    ]);

    const csv = await generateBasCsv({ ...range, periodLabel: "2026-Q4" });
    const dataRow = csv.trim().split("\n")[1]!;
    const cells = dataRow.split(",");

    expect(cells[0]).toBe("2026-Q4");
    expect(cells[1]).toBe("165.00"); // G1 total sales incl. GST
    expect(cells[5]).toBe("15.00"); // 1A GST on sales (net)
  });
});
