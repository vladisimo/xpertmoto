import { describe, it, expect, vi } from "vitest";
import { parseLinktExport, getTollSummaryStats } from "@/server/services/linkt";

// Mirrors the real Linkt CSV export (reconciled 2026-06-15): trip Amounts are
// NEGATIVE, the vehicle is identified by "Tag number" when "LPN" is blank, and
// non-trip rows (Payments / Adjustments / Status) must be filtered out.
const REAL_FORMAT_CSV = [
  `"Start Date","End Date","Type","Details","LPN","Tag number","Fleet ID","Vehicle class","Amount"`,
  `"15/06/2026 12:33","15/06/2026 12:42","Trips","WestConnex  \t  WCX Church St to Ashfield","","0005717034","","Car","-10.79"`,
  `"14/06/2026 09:00","14/06/2026 09:05","Trips","M5 South West Motorway","ABC123","","","Car","-5.50"`,
  `"12/06/2026 00:00","12/06/2026 00:00","Payments","Payment received - thank you","","","","","50.00"`,
  `"11/06/2026 00:00","11/06/2026 00:00","Adjustments","Account adjustment","","0005717034","","Car","-2.00"`,
].join("\n");

describe("parseLinktExport — real Linkt export format", () => {
  const rows = parseLinktExport(REAL_FORMAT_CSV, { id: "acc_1" });

  it("keeps only Trips rows (drops Payments / Adjustments)", () => {
    expect(rows).toHaveLength(2);
  });

  it("converts the negative trip Amount to positive cents", () => {
    expect(rows[0]?.amountCents).toBe(1079);
    expect(rows.every((r) => r.amountCents > 0)).toBe(true);
  });

  it("identifies the vehicle by Tag number when LPN is blank", () => {
    expect(rows[0]?.plate).toBe("0005717034");
  });

  it("identifies the vehicle by LPN when present", () => {
    expect(rows[1]?.plate).toBe("ABC123");
  });

  it("captures the toll point from Details with whitespace collapsed", () => {
    expect(rows[0]?.tollpoint).toBe("WestConnex WCX Church St to Ashfield");
  });

  it("parses the AU date as AEST (UTC+10)", () => {
    // 15/06/2026 12:33 AEST → 02:33 UTC
    expect(rows[0]?.eventAt.toISOString()).toBe("2026-06-15T02:33:00.000Z");
  });

  it("gives each row a stable idempotency hash", () => {
    const again = parseLinktExport(REAL_FORMAT_CSV, { id: "acc_1" });
    expect(again[0]?.externalHash).toBe(rows[0]?.externalHash);
    expect(rows[0]?.externalHash).not.toBe(rows[1]?.externalHash);
  });
});

// A minimal Prisma stub that branches its count() on the where clause, so the
// three toll buckets resolve to distinct numbers without a real DB.
function stubPrisma(opts: {
  matchedToBooking: number;
  vehicleNoBooking: number;
  pendingUnmatched: number;
  withoutPlate: number;
  lastSync: { status: string; finishedAt: Date | null } | null;
  recentInfringements?: unknown[];
  recentUnmatched?: unknown[];
}) {
  return {
    infringement: {
      count: vi.fn(({ where }: { where: { bookingId?: unknown } }) =>
        Promise.resolve(
          where.bookingId && typeof where.bookingId === "object"
            ? opts.matchedToBooking // { not: null }
            : opts.vehicleNoBooking, // null
        ),
      ),
      findMany: vi.fn().mockResolvedValue(opts.recentInfringements ?? []),
    },
    linktUnmatchedRow: {
      count: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve("plate" in where ? opts.withoutPlate : opts.pendingUnmatched),
      ),
      findMany: vi.fn().mockResolvedValue(opts.recentUnmatched ?? []),
    },
    linktSync: { findFirst: vi.fn().mockResolvedValue(opts.lastSync) },
  } as never;
}

describe("getTollSummaryStats", () => {
  it("computes the headline buckets without double-counting", async () => {
    const stats = await getTollSummaryStats(
      stubPrisma({
        matchedToBooking: 5,
        vehicleNoBooking: 2,
        pendingUnmatched: 3,
        withoutPlate: 1,
        lastSync: { status: "SUCCESS", finishedAt: new Date("2026-06-15T03:00:00Z") },
      }),
    );
    expect(stats.totalTolls).toBe(10); // 5 + 2 + 3
    expect(stats.matchedToBooking).toBe(5);
    expect(stats.unmatchedToBooking).toBe(5); // vehicle-no-booking + pending
    expect(stats.withoutPlate).toBe(1);
    expect(stats.withPlate).toBe(9); // 10 - 1
    expect(stats.lastSync).toEqual({
      status: "SUCCESS",
      finishedAt: new Date("2026-06-15T03:00:00Z"),
    });
  });

  it("unions matched + unmatched recent rows, newest first, mapping each bucket", async () => {
    const stats = await getTollSummaryStats(
      stubPrisma({
        matchedToBooking: 1,
        vehicleNoBooking: 1,
        pendingUnmatched: 1,
        withoutPlate: 0,
        lastSync: null,
        recentInfringements: [
          {
            offenceDate: new Date("2026-06-14T00:00:00Z"),
            amount: "5.50",
            bookingId: "bk1",
            notes: "Toll: M5 South West. Source: raw",
            vehicle: { rego: "ABC123" },
            booking: { bookingReference: "XM-1001" },
          },
          {
            offenceDate: new Date("2026-06-10T00:00:00Z"),
            amount: "3.00",
            bookingId: null,
            notes: "Toll: —. Source: raw",
            vehicle: { rego: "ZZZ999" },
            booking: null,
          },
        ],
        recentUnmatched: [
          {
            eventAt: new Date("2026-06-15T00:00:00Z"),
            plate: "",
            tollpoint: "WestConnex",
            amountCents: 1079,
          },
        ],
      }),
    );
    expect(stats.recent.map((r) => r.status)).toEqual(["UNMATCHED", "MATCHED", "NO_BOOKING"]);
    expect(stats.recent[0]).toMatchObject({ plate: "", tollpoint: "WestConnex", amountCents: 1079 });
    expect(stats.recent[1]).toMatchObject({
      plate: "ABC123",
      tollpoint: "M5 South West",
      amountCents: 550,
      matchedBooking: "XM-1001",
    });
    expect(stats.recent[2]).toMatchObject({ tollpoint: "", matchedBooking: null });
    expect(stats.recentTruncated).toBe(false);
  });

  it("handles the all-unmatched / never-synced case", async () => {
    const stats = await getTollSummaryStats(
      stubPrisma({
        matchedToBooking: 0,
        vehicleNoBooking: 0,
        pendingUnmatched: 4,
        withoutPlate: 4,
        lastSync: null,
      }),
    );
    expect(stats.totalTolls).toBe(4);
    expect(stats.matchedToBooking).toBe(0);
    expect(stats.unmatchedToBooking).toBe(4);
    expect(stats.withPlate).toBe(0);
    expect(stats.withoutPlate).toBe(4);
    expect(stats.lastSync).toBeNull();
    expect(stats.recent).toEqual([]);
  });
});
