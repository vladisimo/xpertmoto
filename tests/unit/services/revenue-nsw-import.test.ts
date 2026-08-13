import { describe, expect, it, vi } from "vitest";

import {
  classifyOffence,
  importRevenueNswRows,
  parseRevenueNswExport,
  type RevenueNswRow,
} from "@/server/services/revenue-nsw-import";

const EXPORT_CSV = [
  "Penalty Notice Number,Registration,Offence Date,Issue Date,Penalty Amount,Demerit Points,Offence Description",
  "PN-1001,ABC123,05/04/2026,10/04/2026,$387,3,Exceed speed limit over 10 km/h",
  "PN-1002,XYZ789,2026-04-06,2026-04-09,$320,0,Stop on a no stopping length of road",
].join("\n");

describe("parseRevenueNswExport", () => {
  it("parses notice rows with AU and ISO dates and classifies the offence", () => {
    const rows = parseRevenueNswExport(EXPORT_CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      penaltyNoticeNumber: "PN-1001",
      rego: "ABC123",
      amountAud: 387,
      demeritPoints: 3,
      type: "SPEEDING",
      issuer: "Revenue NSW",
    });
    expect(rows[0]!.offenceDate.toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(rows[0]!.issueDate?.toISOString().slice(0, 10)).toBe("2026-04-10");
    expect(rows[1]!.type).toBe("PARKING");
  });

  it("returns [] for empty or header-only input", () => {
    expect(parseRevenueNswExport("")).toEqual([]);
    expect(parseRevenueNswExport("Penalty Notice Number,Registration,Offence Date")).toEqual([]);
  });
});

describe("classifyOffence", () => {
  it("keys offence types off the description", () => {
    expect(classifyOffence("Exceed speed limit by 15 km/h")).toBe("SPEEDING");
    expect(classifyOffence("Proceed through red traffic light")).toBe("RED_LIGHT");
    expect(classifyOffence("Use mobile phone while driving")).toBe("MOBILE_PHONE");
    expect(classifyOffence("Not wear seatbelt properly adjusted")).toBe("SEATBELT");
    expect(classifyOffence("Stop in no stopping zone")).toBe("PARKING");
    expect(classifyOffence("Drive unregistered vehicle")).toBe("UNREGISTERED");
    expect(classifyOffence("Something unrelated")).toBe("OTHER");
  });
});

function makePrisma(opts: {
  existing?: boolean;
  vehicles?: Array<{ id: string; rego: string; gpsTrackerId: string | null }>;
  bookings?: Array<{ id: string; customerId: string | null; bookingReference?: string }>;
}) {
  const create = vi.fn(async (_args: { data: Record<string, unknown> }) => ({ id: "inf_new" }));
  return {
    create,
    prisma: {
      infringement: {
        findUnique: vi.fn(async () => (opts.existing ? { id: "inf_old" } : null)),
        create,
      },
      vehicle: { findMany: vi.fn(async () => opts.vehicles ?? []) },
      booking: {
        // The swap-aware matcher pulls candidates via findMany. Echo the
        // queried vehicle id onto the fixture bookings (no swaps) so they
        // survive the matcher's vehicleAt filter.
        findMany: vi.fn(async ({ where }: { where: { OR: Array<{ vehicleId?: string }> } }) =>
          (opts.bookings ?? []).map((b) => ({
            bookingReference: `REF-${b.id}`,
            ...b,
            vehicleId: where.OR[0]!.vehicleId,
            swaps: [],
          })),
        ),
      },
    } as unknown as import("@prisma/client").PrismaClient,
  };
}

const row: RevenueNswRow = {
  penaltyNoticeNumber: "PN-1001",
  rego: "ABC123",
  offenceDate: new Date(Date.UTC(2026, 3, 5)),
  issueDate: new Date(Date.UTC(2026, 3, 10)),
  amountAud: 387,
  offenceCode: "1234",
  offenceDescription: "Exceed speed limit",
  offenceLocation: "M2",
  demeritPoints: 3,
  type: "SPEEDING",
  issuer: "Revenue NSW",
};

describe("importRevenueNswRows", () => {
  it("creates a matched notice in PENDING_REVIEW with computed deadline", async () => {
    const { prisma, create } = makePrisma({
      vehicles: [{ id: "v1", rego: "ABC123", gpsTrackerId: null }],
      bookings: [{ id: "bk1", customerId: "c1" }],
    });
    const summary = await importRevenueNswRows(prisma, [row]);
    expect(summary).toMatchObject({ created: 1, matched: 1, unmatched: 0, duplicate: 0 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vehicleId: "v1",
          bookingId: "bk1",
          customerId: "c1",
          status: "PENDING_REVIEW",
          handling: "NOMINATE_DRIVER",
        }),
      }),
    );
    const data = create.mock.calls[0]![0].data as { nominationDeadline: Date };
    expect(data.nominationDeadline.toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("creates an unmatched (but rego-known) notice in RECEIVED", async () => {
    const { prisma, create } = makePrisma({
      vehicles: [{ id: "v1", rego: "ABC123", gpsTrackerId: null }],
      bookings: [],
    });
    const summary = await importRevenueNswRows(prisma, [row]);
    expect(summary).toMatchObject({ created: 1, matched: 0, unmatched: 1 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RECEIVED" }) }),
    );
  });

  it("stages an ambiguous notice in RECEIVED with the candidates listed — never a guessed link", async () => {
    const { prisma, create } = makePrisma({
      vehicles: [{ id: "v1", rego: "ABC123", gpsTrackerId: null }],
      bookings: [
        { id: "bk1", customerId: "c1", bookingReference: "XM-1001" },
        { id: "bk2", customerId: "c2", bookingReference: "XM-1002" },
      ],
    });
    const summary = await importRevenueNswRows(prisma, [row]);
    expect(summary).toMatchObject({ created: 1, matched: 0, unmatched: 1 });
    const data = create.mock.calls[0]![0].data as {
      status: string;
      bookingId: string | null;
      customerId: string | null;
      notes: string;
    };
    expect(data.status).toBe("RECEIVED");
    expect(data.bookingId).toBeNull();
    expect(data.customerId).toBeNull();
    expect(data.notes).toContain("Attribution ambiguous");
    expect(data.notes).toContain("XM-1001, XM-1002");
  });

  it("skips rows whose rego can't be resolved (no vehicle to attach)", async () => {
    const { prisma, create } = makePrisma({ vehicles: [], bookings: [] });
    const summary = await importRevenueNswRows(prisma, [row]);
    expect(summary).toMatchObject({ created: 0, unmatched: 1 });
    expect(create).not.toHaveBeenCalled();
  });

  it("is idempotent on the penalty notice number", async () => {
    const { prisma, create } = makePrisma({ existing: true });
    const summary = await importRevenueNswRows(prisma, [row]);
    expect(summary).toMatchObject({ created: 0, duplicate: 1 });
    expect(create).not.toHaveBeenCalled();
  });
});
