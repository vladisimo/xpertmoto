import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  classifyRowAction,
  normalisePlate,
  parseLinktExport,
  runLinktSync,
} from "@/server/services/linkt";
import { applyInfringementRecoveryCharge } from "@/server/services/infringement-charge";

// runLinktSync reaches the charge path via dynamic import; stub both so the
// row-acquisition + record behaviour can be tested without a DB or Stripe.
vi.mock("@/server/services/toll-admin-fee", () => ({
  getTollAdminFee: vi.fn(async () => 25),
}));
vi.mock("@/server/services/infringement-charge", () => ({
  applyInfringementRecoveryCharge: vi.fn(async () => undefined),
}));

const ACCOUNT = { id: "linkt_acct_1" };

describe("parseLinktExport", () => {
  // A representative Linkt "Export trips" CSV: two preamble rows, a header,
  // two trips, and an account payment. Column names / date format are
  // provisional pending the Phase-0 sample.
  const CSV_WITH_TYPE = [
    "XPERT Moto Fleet,,,,",
    "Statement period: 01/04/2026 - 30/04/2026,,,,",
    "Date and time,LPN,Toll point,Trip cost,Transaction type",
    "05/04/2026 08:14,ABC123,M2 Pennant Hills,4.27,Trip",
    "06/04/2026 17:42,XYZ789,NorthConnex,8.13,Trip",
    "07/04/2026 09:00,ABC123,Account payment,-50.00,Payment",
  ].join("\n");

  test("skips preamble, parses trips, excludes the payment row via the type column", () => {
    const rows = parseLinktExport(CSV_WITH_TYPE, ACCOUNT);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.plate)).toEqual(["ABC123", "XYZ789"]);
    expect(rows.map((r) => r.amountCents)).toEqual([427, 813]);
    expect(rows[0]!.tollpoint).toBe("M2 Pennant Hills");
  });

  test("derives a deterministic, per-trip externalHash", () => {
    const a = parseLinktExport(CSV_WITH_TYPE, ACCOUNT);
    const b = parseLinktExport(CSV_WITH_TYPE, ACCOUNT);
    // Stable across runs (idempotency key) …
    expect(a[0]!.externalHash).toBe(b[0]!.externalHash);
    // … and distinct per trip.
    expect(a[0]!.externalHash).not.toBe(a[1]!.externalHash);
    // … and scoped to the account id (different account → different hash).
    const other = parseLinktExport(CSV_WITH_TYPE, { id: "linkt_acct_2" });
    expect(other[0]!.externalHash).not.toBe(a[0]!.externalHash);
  });

  test("without a type column, a negative amount (credit) is excluded by sign", () => {
    const csv = [
      "Date,Registration,Location,Amount",
      "10/04/2026 06:00,ABC123,M5 East,3.50",
      "11/04/2026,ABC123,Credit adjustment,-5.00",
    ].join("\n");
    const rows = parseLinktExport(csv, ACCOUNT);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountCents).toBe(350);
    expect(rows[0]!.plate).toBe("ABC123");
  });

  test("returns [] for empty or header-only input", () => {
    expect(parseLinktExport("", ACCOUNT)).toEqual([]);
    expect(parseLinktExport("Date,Plate,Amount", ACCOUNT)).toEqual([]);
  });
});

describe("normalisePlate", () => {
  test("uppercases and strips spaces/hyphens so plate variants match", () => {
    expect(normalisePlate("ab-c 123")).toBe("ABC123");
    expect(normalisePlate("")).toBe("");
  });
});

describe("classifyRowAction", () => {
  const NEVER_SEEN = { existingInfringement: false, existingUnmatched: null, matched: true };

  test("skips when an Infringement already exists (pure idempotency)", () => {
    expect(classifyRowAction({ ...NEVER_SEEN, existingInfringement: true })).toEqual({
      type: "skip-duplicate",
    });
  });

  test("skip-duplicate wins over a dismissed unmatched row", () => {
    expect(
      classifyRowAction({
        existingInfringement: true,
        existingUnmatched: { resolvedAt: new Date(), resolvedAction: "DISMISSED" },
        matched: false,
      }),
    ).toEqual({ type: "skip-duplicate" });
  });

  test("previously dismissed rows don't re-surface", () => {
    expect(
      classifyRowAction({
        existingInfringement: false,
        existingUnmatched: { resolvedAt: new Date(), resolvedAction: "DISMISSED" },
        matched: true,
      }),
    ).toEqual({ type: "skip-dismissed" });
  });

  test("matched, brand-new row → create a fresh Infringement", () => {
    expect(classifyRowAction(NEVER_SEEN)).toEqual({ type: "create-new" });
  });

  test("matched with a pending unmatched row → create + auto-resolve it", () => {
    expect(
      classifyRowAction({
        existingInfringement: false,
        existingUnmatched: { resolvedAt: null, resolvedAction: null },
        matched: true,
      }),
    ).toEqual({ type: "create-and-resolve-existing" });
  });

  test("matched with an already auto-resolved row → plain create-new", () => {
    expect(
      classifyRowAction({
        existingInfringement: false,
        existingUnmatched: { resolvedAt: new Date(), resolvedAction: "AUTO_MATCHED" },
        matched: true,
      }),
    ).toEqual({ type: "create-new" });
  });

  test("unmatched, brand-new row → record for staff reconciliation (never dropped)", () => {
    expect(
      classifyRowAction({ existingInfringement: false, existingUnmatched: null, matched: false }),
    ).toEqual({ type: "record-unmatched" });
  });

  test("unmatched with an existing pending row → no-op refresh", () => {
    expect(
      classifyRowAction({
        existingInfringement: false,
        existingUnmatched: { resolvedAt: null, resolvedAction: null },
        matched: false,
      }),
    ).toEqual({ type: "refresh-unmatched" });
  });
});

// A representative two-trip Linkt export (header + two trips).
const EXPORT_CSV = [
  "Date and time,LPN,Toll point,Trip cost,Transaction type",
  "05/04/2026 08:14,ABC123,M2 Pennant Hills,4.27,Trip",
  "06/04/2026 17:42,XYZ789,NorthConnex,8.13,Trip",
].join("\n");

type PrismaStubOpts = {
  account?: Record<string, unknown>;
  vehicles?: Array<{ id: string; rego: string; gpsTrackerId: string | null }>;
  booking?: { id: string; customerId: string | null } | null;
  existingInfringement?: { id: string } | null;
  existingUnmatched?: { id: string; resolvedAt: Date | null; resolvedAction: string | null } | null;
  pendingUnmatched?: Array<{
    externalHash: string;
    eventAt: Date;
    plate: string;
    tollpoint: string;
    amountCents: number;
    rawDetails: string | null;
  }>;
};

/** Minimal Prisma stub covering only the methods runLinktSync touches. */
function makePrisma(opts: PrismaStubOpts = {}) {
  return {
    linktAccount: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: "acct_1",
        name: "Linkt NSW",
        region: "NSW",
        adminFeeCents: 0,
        isActive: true,
        ...opts.account,
      })),
      update: vi.fn(async () => ({})),
    },
    linktSync: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "sync_1" })),
      update: vi.fn(async () => ({})),
    },
    infringement: {
      findUnique: vi.fn(async () => opts.existingInfringement ?? null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({
        id: "inf_1",
        referenceNumber: "ref_1",
        type: "TOLL",
        issuer: "Linkt-NSW (Linkt NSW)",
      })),
    },
    linktUnmatchedRow: {
      findUnique: vi.fn(async () => opts.existingUnmatched ?? null),
      create: vi.fn(async () => ({ id: "um_new" })),
      update: vi.fn(async () => ({})),
      findMany: vi.fn(async () => opts.pendingUnmatched ?? []),
    },
    vehicle: {
      findMany: vi.fn(async () => opts.vehicles ?? []),
    },
    booking: {
      // The swap-aware matcher pulls candidates via findMany. Echo the queried
      // vehicle id onto the fixture booking (no swaps) so it survives the
      // matcher's vehicleAt filter for whichever vehicle the trip resolved to.
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ vehicleId?: string }> } }) =>
        opts.booking
          ? [
              {
                ...opts.booking,
                bookingReference: "XM-1001",
                vehicleId: where.OR[0]!.vehicleId,
                swaps: [],
              },
            ]
          : [],
      ),
    },
  };
}

describe("runLinktSync", () => {
  beforeEach(() => vi.clearAllMocks());

  test("ingests an uploaded buffer and records unmatched trips (no portal, no fetch)", async () => {
    const prisma = makePrisma({ vehicles: [] }); // nothing matches → all unmatched
    const res = await runLinktSync(prisma as unknown as PrismaClient, "acct_1", {
      buffer: Buffer.from(EXPORT_CSV),
    });

    expect(res.status).toBe("PARTIAL");
    expect(prisma.linktUnmatchedRow.create).toHaveBeenCalledTimes(2);
    expect(prisma.infringement.create).not.toHaveBeenCalled();
    expect(prisma.linktSync.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PARTIAL",
          rowsFetched: 2,
          rowsCreated: 0,
          rowsUnmatched: 2,
        }),
      }),
    );
  });

  test("buffer rows that match a booking become charged TOLL infringements", async () => {
    const prisma = makePrisma({
      vehicles: [
        { id: "v1", rego: "ABC 123", gpsTrackerId: null },
        { id: "v2", rego: "XYZ789", gpsTrackerId: null },
      ],
      booking: { id: "bk1", customerId: "cust1" },
    });
    const res = await runLinktSync(prisma as unknown as PrismaClient, "acct_1", {
      buffer: Buffer.from(EXPORT_CSV),
    });

    expect(res.status).toBe("SUCCESS");
    expect(prisma.infringement.create).toHaveBeenCalledTimes(2);
    expect(applyInfringementRecoveryCharge).toHaveBeenCalledTimes(2);
    expect(prisma.linktUnmatchedRow.create).not.toHaveBeenCalled();
  });

  test("re-uploading the same export is idempotent — no new infringement or charge", async () => {
    const prisma = makePrisma({
      existingInfringement: { id: "inf_existing" }, // every row already raised
      vehicles: [{ id: "v1", rego: "ABC123", gpsTrackerId: null }],
      booking: { id: "bk1", customerId: "cust1" },
    });
    const res = await runLinktSync(prisma as unknown as PrismaClient, "acct_1", {
      buffer: Buffer.from(EXPORT_CSV),
    });

    expect(res.status).toBe("SUCCESS"); // all duplicates, none unmatched
    expect(prisma.infringement.create).not.toHaveBeenCalled();
    expect(applyInfringementRecoveryCharge).not.toHaveBeenCalled();
    expect(prisma.linktUnmatchedRow.create).not.toHaveBeenCalled();
  });

  test("without a buffer it runs a rematch pass over pending rows, never fetching", async () => {
    const prisma = makePrisma({
      pendingUnmatched: [
        {
          externalHash: "h1",
          eventAt: new Date("2026-04-05T08:14:00Z"),
          plate: "ABC123",
          tollpoint: "M2",
          amountCents: 427,
          rawDetails: "x",
        },
      ],
      existingUnmatched: { id: "um1", resolvedAt: null, resolvedAction: null },
      vehicles: [], // still unmatched after rematch
    });
    const res = await runLinktSync(prisma as unknown as PrismaClient, "acct_1");

    expect(prisma.linktUnmatchedRow.findMany).toHaveBeenCalledTimes(1); // rematch source
    expect(res.status).toBe("PARTIAL");
    expect(prisma.infringement.create).not.toHaveBeenCalled();
    expect(prisma.linktUnmatchedRow.create).not.toHaveBeenCalled(); // refresh, not re-create
  });
});

describe("XLSX decompression-bomb guard", () => {
  // Build a real, minimal XLSX with the same shape as the CSV fixture so the
  // happy path proves a legitimate Linkt export still parses.
  function makeXlsxBuffer(): Buffer {
    const XLSX = require("xlsx") as typeof import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      ["Date and time", "LPN", "Toll point", "Trip cost", "Transaction type"],
      ["05/04/2026 08:14", "ABC123", "M2 Pennant Hills", "4.27", "Trip"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trips");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  test("a legitimate XLSX export parses", () => {
    const rows = parseLinktExport(makeXlsxBuffer(), ACCOUNT);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.plate).toBe("ABC123");
  });

  test("rejects a PK-prefixed buffer with no readable central directory", () => {
    const junk = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(64, 0x41)]);
    expect(() => parseLinktExport(junk, ACCOUNT)).toThrow(/XLSX rejected/);
  });

  test("rejects an archive whose central directory declares ZIP64 sizes", () => {
    const buf = makeXlsxBuffer();
    // Locate the EOCD, walk to the first central-directory entry, and patch
    // its uncompressed-size field to the ZIP64 marker (0xFFFFFFFF).
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    expect(eocd).toBeGreaterThan(0);
    const cdirOffset = buf.readUInt32LE(eocd + 16);
    expect(buf.readUInt32LE(cdirOffset)).toBe(0x02014b50);
    buf.writeUInt32LE(0xffffffff, cdirOffset + 24);
    expect(() => parseLinktExport(buf, ACCOUNT)).toThrow(/XLSX rejected/);
  });

  test("rejects an archive declaring an implausibly large uncompressed size", () => {
    const buf = makeXlsxBuffer();
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    const cdirOffset = buf.readUInt32LE(eocd + 16);
    // 512 MB declared on the first entry — over the 100 MB cap.
    buf.writeUInt32LE(512 * 1024 * 1024, cdirOffset + 24);
    expect(() => parseLinktExport(buf, ACCOUNT)).toThrow(/XLSX rejected/);
  });
});
