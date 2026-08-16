import { describe, expect, it, vi } from "vitest";

import {
  findBookingForVehicleAt,
  findCandidateBookingsForVehicleAt,
  normalisePlate,
  resolveBookingForVehicleAt,
  resolveVehicleByPlate,
} from "@/server/services/booking-matcher";

function vehiclesPrisma(
  vehicles: Array<{ id: string; rego: string; gpsTrackerId: string | null }>,
) {
  return {
    vehicle: { findMany: vi.fn(async () => vehicles) },
  } as unknown as import("@prisma/client").PrismaClient;
}

describe("normalisePlate", () => {
  it("uppercases and strips spaces/dashes", () => {
    expect(normalisePlate("ab-c 123")).toBe("ABC123");
    expect(normalisePlate("")).toBe("");
  });
});

describe("resolveVehicleByPlate", () => {
  it("matches by rego (normalised) first", async () => {
    const prisma = vehiclesPrisma([
      { id: "v1", rego: "ABC 123", gpsTrackerId: null },
      { id: "v2", rego: "XYZ789", gpsTrackerId: null },
    ]);
    expect(await resolveVehicleByPlate(prisma, "abc123")).toEqual({ id: "v1", rego: "ABC 123" });
  });

  it("falls back to the toll-tag id", async () => {
    const prisma = vehiclesPrisma([{ id: "v1", rego: "AAA111", gpsTrackerId: "TAG-99" }]);
    expect(await resolveVehicleByPlate(prisma, "tag99")).toEqual({ id: "v1", rego: "AAA111" });
  });

  it("returns null on empty token or no match", async () => {
    const prisma = vehiclesPrisma([{ id: "v1", rego: "AAA111", gpsTrackerId: null }]);
    expect(await resolveVehicleByPlate(prisma, "")).toBeNull();
    expect(await resolveVehicleByPlate(prisma, "ZZZ999")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Swap-aware booking attribution
// ---------------------------------------------------------------------------

type FixtureSwap = {
  outgoingVehicleId: string;
  incomingVehicleId: string | null;
  swappedAt: Date;
};

type FixtureBooking = {
  id: string;
  vehicleId: string | null; // current vehicle (overwritten by each swap)
  swaps?: FixtureSwap[]; // committed swaps only, any order
};

/**
 * findMany stub that emulates the widened candidate query's vehicle-
 * involvement OR (current vehicleId, or a committed swap touching the
 * vehicle). Time-window/status clauses are asserted separately — every
 * fixture stands for an in-window held booking, as the DB would return.
 */
function bookingsPrisma(bookings: FixtureBooking[]) {
  const findMany = vi.fn(async ({ where }: { where: { OR: Array<{ vehicleId?: string }> } }) => {
    const vehicleId = where.OR[0]!.vehicleId!;
    return bookings
      .filter(
        (b) =>
          b.vehicleId === vehicleId ||
          (b.swaps ?? []).some(
            (s) => s.outgoingVehicleId === vehicleId || s.incomingVehicleId === vehicleId,
          ),
      )
      .map((b) => ({
        id: b.id,
        bookingReference: `REF-${b.id}`,
        customerId: `cust-${b.id}`,
        status: "ACTIVE",
        pickupDateTime: new Date("2026-04-01T00:00:00Z"),
        returnDateTime: new Date("2026-04-30T00:00:00Z"),
        customer: { firstName: "Jo", lastName: "Renter", email: "jo@example.com" },
        vehicleId: b.vehicleId,
        swaps: [...(b.swaps ?? [])].sort((a, z) => a.swappedAt.getTime() - z.swappedAt.getTime()),
      }));
  });
  return {
    prisma: { booking: { findMany } } as unknown as import("@prisma/client").PrismaClient,
    findMany,
  };
}

const SWAP1_AT = new Date("2026-04-10T00:00:00Z");
const SWAP2_AT = new Date("2026-04-20T00:00:00Z");
const BEFORE_SWAP1 = new Date("2026-04-05T08:00:00Z");
const BETWEEN_SWAPS = new Date("2026-04-15T08:00:00Z");
const AFTER_SWAP2 = new Date("2026-04-25T08:00:00Z");

// Booking that started on v1 and was swapped to v2 mid-hire: vehicleId now
// holds v2, the original vehicle is only recoverable from the swap chain.
const SWAPPED: FixtureBooking = {
  id: "bkSwap",
  vehicleId: "v2",
  swaps: [{ outgoingVehicleId: "v1", incomingVehicleId: "v2", swappedAt: SWAP1_AT }],
};

describe("resolveBookingForVehicleAt — swap-aware attribution", () => {
  it("keeps the widened query's status/time clauses and swap OR", async () => {
    const { prisma, findMany } = bookingsPrisma([]);
    await resolveBookingForVehicleAt(prisma, "v1", BEFORE_SWAP1);

    const where = findMany.mock.calls[0]![0].where as {
      OR: unknown[];
      status: { in: string[] };
      AND: unknown[];
    };
    expect(where.OR[0]).toEqual({ vehicleId: "v1" });
    expect(JSON.stringify(where.OR[1])).toContain("COMMITTED");
    expect(JSON.stringify(where.OR[1])).toContain("outgoingVehicleId");
    expect(JSON.stringify(where.OR[1])).toContain("incomingVehicleId");
    expect(where.status.in).toContain("CHECKED_OUT");
    expect(where.status.in).not.toContain("CANCELLED");
    expect(where.AND).toHaveLength(2);
    expect(JSON.stringify(where.AND)).toContain("actualPickupDateTime");
    expect(JSON.stringify(where.AND)).toContain("actualReturnDateTime");
  });

  it("matches a no-swap booking on its vehicleId", async () => {
    const { prisma } = bookingsPrisma([{ id: "bkPlain", vehicleId: "v1" }]);
    const res = await resolveBookingForVehicleAt(prisma, "v1", BEFORE_SWAP1);
    expect(res).toMatchObject({ kind: "match", booking: { id: "bkPlain" } });
  });

  it("event on the outgoing vehicle BEFORE the swap matches the swapped booking", async () => {
    const { prisma } = bookingsPrisma([SWAPPED]);
    const res = await resolveBookingForVehicleAt(prisma, "v1", BEFORE_SWAP1);
    expect(res).toMatchObject({ kind: "match", booking: { id: "bkSwap" } });
    // Internal reconstruction fields never leak to callers.
    expect(res.kind === "match" && res.booking).not.toHaveProperty("swaps");
  });

  it("event on the outgoing vehicle AFTER the swap does NOT match the swapped booking", async () => {
    const { prisma } = bookingsPrisma([SWAPPED]);
    expect(await resolveBookingForVehicleAt(prisma, "v1", BETWEEN_SWAPS)).toEqual({
      kind: "none",
    });
  });

  it("… and matches the next renter of the outgoing vehicle when present", async () => {
    const { prisma } = bookingsPrisma([SWAPPED, { id: "bkNext", vehicleId: "v1" }]);
    const res = await resolveBookingForVehicleAt(prisma, "v1", BETWEEN_SWAPS);
    expect(res).toMatchObject({ kind: "match", booking: { id: "bkNext" } });
  });

  it("event on the incoming vehicle BEFORE swappedAt does NOT match the swapped booking", async () => {
    const { prisma } = bookingsPrisma([SWAPPED]);
    expect(await resolveBookingForVehicleAt(prisma, "v2", BEFORE_SWAP1)).toEqual({
      kind: "none",
    });
  });

  it("event on the incoming vehicle after swappedAt matches the swapped booking", async () => {
    const { prisma } = bookingsPrisma([SWAPPED]);
    const res = await resolveBookingForVehicleAt(prisma, "v2", BETWEEN_SWAPS);
    expect(res).toMatchObject({ kind: "match", booking: { id: "bkSwap" } });
  });

  it("a two-swap chain resolves each vehicle only for its held period", async () => {
    const chained: FixtureBooking = {
      id: "bkChain",
      vehicleId: "v3",
      swaps: [
        // Deliberately out of order — the matcher orders by swappedAt asc.
        { outgoingVehicleId: "v2", incomingVehicleId: "v3", swappedAt: SWAP2_AT },
        { outgoingVehicleId: "v1", incomingVehicleId: "v2", swappedAt: SWAP1_AT },
      ],
    };
    const { prisma } = bookingsPrisma([chained]);

    // Each vehicle matches inside its period…
    expect(await resolveBookingForVehicleAt(prisma, "v1", BEFORE_SWAP1)).toMatchObject({
      kind: "match",
      booking: { id: "bkChain" },
    });
    expect(await resolveBookingForVehicleAt(prisma, "v2", BETWEEN_SWAPS)).toMatchObject({
      kind: "match",
      booking: { id: "bkChain" },
    });
    expect(await resolveBookingForVehicleAt(prisma, "v3", AFTER_SWAP2)).toMatchObject({
      kind: "match",
      booking: { id: "bkChain" },
    });

    // …and never outside it.
    expect(await resolveBookingForVehicleAt(prisma, "v1", BETWEEN_SWAPS)).toEqual({ kind: "none" });
    expect(await resolveBookingForVehicleAt(prisma, "v2", BEFORE_SWAP1)).toEqual({ kind: "none" });
    expect(await resolveBookingForVehicleAt(prisma, "v2", AFTER_SWAP2)).toEqual({ kind: "none" });
    expect(await resolveBookingForVehicleAt(prisma, "v3", BEFORE_SWAP1)).toEqual({ kind: "none" });
  });

  it("overlapping bookings on the same vehicle come back ambiguous with all candidates", async () => {
    const { prisma } = bookingsPrisma([
      { id: "bkA", vehicleId: "v1" },
      { id: "bkB", vehicleId: "v1" },
    ]);
    const res = await resolveBookingForVehicleAt(prisma, "v1", BEFORE_SWAP1);
    expect(res.kind).toBe("ambiguous");
    expect(res.kind === "ambiguous" && res.candidates.map((c) => c.id).sort()).toEqual([
      "bkA",
      "bkB",
    ]);
  });
});

describe("findCandidateBookingsForVehicleAt", () => {
  it("filters swap-widened candidates down to those actually holding the vehicle at T", async () => {
    const { prisma } = bookingsPrisma([SWAPPED, { id: "bkNext", vehicleId: "v1" }]);
    const candidates = await findCandidateBookingsForVehicleAt(prisma, "v1", BETWEEN_SWAPS);
    expect(candidates.map((c) => c.id)).toEqual(["bkNext"]);
  });
});

describe("findBookingForVehicleAt (deprecated wrapper)", () => {
  it("returns the booking only on an unambiguous match", async () => {
    const { prisma } = bookingsPrisma([{ id: "bkPlain", vehicleId: "v1" }]);
    expect(await findBookingForVehicleAt(prisma, "v1", BEFORE_SWAP1)).toMatchObject({
      id: "bkPlain",
    });
  });

  it("returns null when no booking held the vehicle at that time", async () => {
    const { prisma } = bookingsPrisma([]);
    expect(await findBookingForVehicleAt(prisma, "v1", new Date())).toBeNull();
  });

  it("returns null on ambiguity — it never guesses between overlapping bookings", async () => {
    const { prisma } = bookingsPrisma([
      { id: "bkA", vehicleId: "v1" },
      { id: "bkB", vehicleId: "v1" },
    ]);
    expect(await findBookingForVehicleAt(prisma, "v1", BEFORE_SWAP1)).toBeNull();
  });
});
