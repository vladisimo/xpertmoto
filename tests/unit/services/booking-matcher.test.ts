import { describe, expect, it, vi } from "vitest";

import {
  findBookingForVehicleAt,
  normalisePlate,
  resolveVehicleByPlate,
} from "@/server/services/booking-matcher";

function prismaWith(opts: {
  vehicles?: Array<{ id: string; rego: string; gpsTrackerId: string | null }>;
  booking?: unknown;
}) {
  const findFirst = vi.fn(async (_args: { where: Record<string, unknown> }) => opts.booking ?? null);
  return {
    prisma: {
      vehicle: { findMany: vi.fn(async () => opts.vehicles ?? []) },
      booking: { findFirst },
    } as unknown as import("@prisma/client").PrismaClient,
    findFirst,
  };
}

describe("normalisePlate", () => {
  it("uppercases and strips spaces/dashes", () => {
    expect(normalisePlate("ab-c 123")).toBe("ABC123");
    expect(normalisePlate("")).toBe("");
  });
});

describe("resolveVehicleByPlate", () => {
  it("matches by rego (normalised) first", async () => {
    const { prisma } = prismaWith({
      vehicles: [
        { id: "v1", rego: "ABC 123", gpsTrackerId: null },
        { id: "v2", rego: "XYZ789", gpsTrackerId: null },
      ],
    });
    expect(await resolveVehicleByPlate(prisma, "abc123")).toEqual({ id: "v1", rego: "ABC 123" });
  });

  it("falls back to the toll-tag id", async () => {
    const { prisma } = prismaWith({
      vehicles: [{ id: "v1", rego: "AAA111", gpsTrackerId: "TAG-99" }],
    });
    expect(await resolveVehicleByPlate(prisma, "tag99")).toEqual({ id: "v1", rego: "AAA111" });
  });

  it("returns null on empty token or no match", async () => {
    const { prisma } = prismaWith({ vehicles: [{ id: "v1", rego: "AAA111", gpsTrackerId: null }] });
    expect(await resolveVehicleByPlate(prisma, "")).toBeNull();
    expect(await resolveVehicleByPlate(prisma, "ZZZ999")).toBeNull();
  });
});

describe("findBookingForVehicleAt", () => {
  it("restricts to held statuses and uses actual-times with scheduled fallback", async () => {
    const at = new Date("2026-04-05T08:14:00Z");
    const { prisma, findFirst } = prismaWith({
      booking: { id: "bk1", customerId: "c1" },
    });
    const result = await findBookingForVehicleAt(prisma, "v1", at);
    expect(result).toEqual({ id: "bk1", customerId: "c1" });

    const where = findFirst.mock.calls[0]![0].where as {
      vehicleId: string;
      status: { in: string[] };
      AND: unknown[];
    };
    expect(where.vehicleId).toBe("v1");
    expect(where.status.in).toContain("CHECKED_OUT");
    expect(where.status.in).not.toContain("CANCELLED");
    // actual-pickup-or-scheduled and actual-return-or-open windows.
    expect(where.AND).toHaveLength(2);
    expect(JSON.stringify(where.AND)).toContain("actualPickupDateTime");
    expect(JSON.stringify(where.AND)).toContain("actualReturnDateTime");
  });

  it("returns null when no booking held the vehicle at that time", async () => {
    const { prisma } = prismaWith({ booking: null });
    expect(await findBookingForVehicleAt(prisma, "v1", new Date())).toBeNull();
  });
});
