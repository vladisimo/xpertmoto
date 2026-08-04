import { describe, it, expect, vi, beforeEach } from "vitest";

// The matcher + charge helper are exercised by upsertInfringementFromRow /
// reconcileReceivedTolls below; stub them so those branches are observable
// without a DB. Keep the rest of booking-matcher real (parseLinktExport uses
// normalisePlate).
const resolveVehicleByPlate = vi.fn();
const findBookingForVehicleAt = vi.fn();
vi.mock("@/server/services/booking-matcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/booking-matcher")>();
  return {
    ...actual,
    resolveVehicleByPlate: (...a: unknown[]) => resolveVehicleByPlate(...a),
    findBookingForVehicleAt: (...a: unknown[]) => findBookingForVehicleAt(...a),
  };
});
const applyInfringementRecoveryCharge = vi.fn().mockResolvedValue({
  paymentId: "pay_1",
  alreadyExisted: false,
  amount: 13.29,
});
vi.mock("@/server/services/infringement-charge", () => ({
  applyInfringementRecoveryCharge: (...a: unknown[]) => applyInfringementRecoveryCharge(...a),
}));

import {
  parseLinktExport,
  getTollSummaryStats,
  upsertInfringementFromRow,
  reconcileReceivedTolls,
} from "@/server/services/linkt";

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

// --- charge branches -------------------------------------------------------

const ACCOUNT = {
  id: "acc_1",
  name: "Fleet",
  region: "NSW",
  adminFeeCents: 250, // per-account override, so no toll-admin-fee import needed
} as never;

const ROW = {
  externalHash: "hash_abc",
  eventAt: new Date("2026-06-15T02:33:00Z"),
  plate: "ABC123",
  tollpoint: "M5 South West",
  amountCents: 1079,
  rawDetails: "raw details",
};

function upsertPrisma(over: Record<string, unknown> = {}) {
  return {
    infringement: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "inf_1",
        referenceNumber: ROW.externalHash,
        type: "TOLL",
        issuer: "Linkt-NSW (Fleet)",
      }),
    },
    linktUnmatchedRow: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "u1" }),
      update: vi.fn().mockResolvedValue({ id: "u1" }),
    },
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  applyInfringementRecoveryCharge.mockResolvedValue({
    paymentId: "pay_1",
    alreadyExisted: false,
    amount: 13.29,
  });
});

describe("upsertInfringementFromRow — booking match charges the renter", () => {
  it("creates a CUSTOMER_CHARGED toll and raises the recovery charge (status ⇒ payment invariant)", async () => {
    resolveVehicleByPlate.mockResolvedValue({ id: "veh_1", rego: "ABC123" });
    findBookingForVehicleAt.mockResolvedValue({ id: "bk_1", customerId: "cust_1" });
    const prisma = upsertPrisma();

    const result = await upsertInfringementFromRow(prisma, ROW, ACCOUNT);

    expect(result).toBe("created");
    const createArgs = (prisma as never as { infringement: { create: ReturnType<typeof vi.fn> } })
      .infringement.create.mock.calls[0]![0] as { data: { status: string; bookingId: string | null } };
    expect(createArgs.data.status).toBe("CUSTOMER_CHARGED");
    expect(createArgs.data.bookingId).toBe("bk_1");
    // Invariant: a CUSTOMER_CHARGED toll always raises the recovery Payment.
    expect(applyInfringementRecoveryCharge).toHaveBeenCalledTimes(1);
    expect(applyInfringementRecoveryCharge.mock.calls[0]![0]).toMatchObject({
      infringement: { bookingId: "bk_1", customerId: "cust_1", referenceNumber: "hash_abc" },
    });
  });

  it("resolves a prior pending unmatched row (AUTO_MATCHED) and still charges", async () => {
    resolveVehicleByPlate.mockResolvedValue({ id: "veh_1", rego: "ABC123" });
    findBookingForVehicleAt.mockResolvedValue({ id: "bk_1", customerId: "cust_1" });
    const prisma = upsertPrisma({
      linktUnmatchedRow: {
        findUnique: vi.fn().mockResolvedValue({ id: "u1", resolvedAt: null, resolvedAction: null }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: "u1" }),
      },
    });

    const result = await upsertInfringementFromRow(prisma, ROW, ACCOUNT);

    expect(result).toBe("created");
    expect(
      (prisma as never as { linktUnmatchedRow: { update: ReturnType<typeof vi.fn> } }).linktUnmatchedRow.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resolvedAction: "AUTO_MATCHED" }) }),
    );
    expect(applyInfringementRecoveryCharge).toHaveBeenCalledTimes(1);
  });
});

describe("upsertInfringementFromRow — vehicle-only and no-vehicle", () => {
  it("records a RECEIVED toll with no charge when no booking spanned the trip", async () => {
    resolveVehicleByPlate.mockResolvedValue({ id: "veh_1", rego: "ABC123" });
    findBookingForVehicleAt.mockResolvedValue(null);
    const prisma = upsertPrisma();

    const result = await upsertInfringementFromRow(prisma, ROW, ACCOUNT);

    expect(result).toBe("created");
    const createArgs = (prisma as never as { infringement: { create: ReturnType<typeof vi.fn> } })
      .infringement.create.mock.calls[0]![0] as { data: { status: string; bookingId: string | null } };
    expect(createArgs.data.status).toBe("RECEIVED");
    expect(createArgs.data.bookingId).toBeNull();
    expect(applyInfringementRecoveryCharge).not.toHaveBeenCalled();
  });

  it("captures an unmatched row (no vehicle) without creating an infringement", async () => {
    resolveVehicleByPlate.mockResolvedValue(null);
    const prisma = upsertPrisma();

    const result = await upsertInfringementFromRow(prisma, ROW, ACCOUNT);

    expect(result).toBe("unmatched");
    expect(
      (prisma as never as { linktUnmatchedRow: { create: ReturnType<typeof vi.fn> } }).linktUnmatchedRow.create,
    ).toHaveBeenCalledTimes(1);
    expect(
      (prisma as never as { infringement: { create: ReturnType<typeof vi.fn> } }).infringement.create,
    ).not.toHaveBeenCalled();
    expect(applyInfringementRecoveryCharge).not.toHaveBeenCalled();
  });
});

describe("reconcileReceivedTolls — re-attributes tolls once a booking exists", () => {
  const RECEIVED = {
    id: "inf_r",
    referenceNumber: "hash_r",
    type: "TOLL",
    issuer: "Linkt-NSW (Fleet)",
    amount: 10.79,
    adminFee: 2.5,
    vehicleId: "veh_1",
    offenceDate: new Date("2026-06-15T02:33:00Z"),
  };

  function reconcilePrisma(received: unknown[]) {
    return {
      infringement: {
        findMany: vi.fn().mockResolvedValue(received),
        update: vi.fn().mockResolvedValue({}),
      },
    } as never;
  }

  it("links the booking, flips to CUSTOMER_CHARGED and charges exactly once", async () => {
    findBookingForVehicleAt.mockResolvedValue({ id: "bk_1", customerId: "cust_1" });
    const prisma = reconcilePrisma([RECEIVED]);

    const charged = await reconcileReceivedTolls(prisma, ACCOUNT);

    expect(charged).toBe(1);
    expect(
      (prisma as never as { infringement: { update: ReturnType<typeof vi.fn> } }).infringement.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { bookingId: "bk_1", customerId: "cust_1", status: "CUSTOMER_CHARGED" },
      }),
    );
    expect(applyInfringementRecoveryCharge).toHaveBeenCalledTimes(1);
    expect(applyInfringementRecoveryCharge.mock.calls[0]![0]).toMatchObject({
      infringement: { referenceNumber: "hash_r", bookingId: "bk_1", customerId: "cust_1" },
    });
  });

  it("leaves a still-unattributable toll untouched", async () => {
    findBookingForVehicleAt.mockResolvedValue(null);
    const prisma = reconcilePrisma([RECEIVED]);

    const charged = await reconcileReceivedTolls(prisma, ACCOUNT);

    expect(charged).toBe(0);
    expect(
      (prisma as never as { infringement: { update: ReturnType<typeof vi.fn> } }).infringement.update,
    ).not.toHaveBeenCalled();
    expect(applyInfringementRecoveryCharge).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the account by exact issuer, and to unattributed RECEIVED tolls", async () => {
    findBookingForVehicleAt.mockResolvedValue(null);
    const prisma = reconcilePrisma([]);

    await reconcileReceivedTolls(prisma, ACCOUNT);

    const where = (prisma as never as { infringement: { findMany: ReturnType<typeof vi.fn> } })
      .infringement.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      type: "TOLL",
      bookingId: null,
      status: "RECEIVED",
      issuer: "Linkt-NSW (Fleet)",
    });
  });
});
