import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/cache", () => ({ invalidateTag: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { adminRouter } from "@/server/trpc/router/admin";

type Caller = ReturnType<typeof adminRouter.createCaller>;

function makePrisma(overrides: {
  findUniqueModel?: unknown;
  updateModel?: unknown;
  findUniqueVehicle?: unknown;
  updateVehicle?: unknown;
  findManyModels?: unknown;
  findManyTiers?: unknown;
} = {}) {
  return {
    vehicleModel: {
      findMany: vi.fn().mockResolvedValue(overrides.findManyModels ?? []),
      findUnique: vi.fn().mockResolvedValue(overrides.findUniqueModel ?? null),
      update: vi.fn().mockResolvedValue(
        overrides.updateModel ?? {
          id: "m1",
          make: "Honda",
          model: "CB125F",
          year: 2024,
          baseRate: new Prisma.Decimal(110),
          basePeriodHours: "H24",
        },
      ),
    },
    vehicle: {
      findUnique: vi.fn().mockResolvedValue(overrides.findUniqueVehicle ?? null),
      update: vi.fn().mockResolvedValue(
        overrides.updateVehicle ?? {
          id: "v1",
          baseRateOverride: new Prisma.Decimal(140),
          basePeriodHoursOverride: "H24",
        },
      ),
    },
    pricingTier: {
      findMany: vi.fn().mockResolvedValue(overrides.findManyTiers ?? []),
    },
  };
}

function adminCtx(prisma: unknown) {
  return {
    prisma,
    user: {
      id: "admin1",
      email: "admin@xpert.test",
      name: "Admin",
      role: "ADMIN",
      depotId: null,
    },
    session: {
      user: {
        id: "admin1",
        email: "admin@xpert.test",
        name: "Admin",
        role: "ADMIN",
        depotId: null,
      },
    },
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
    headers: undefined,
  } as unknown as Parameters<Caller["modelRates"]>[0];
}

function customerCtx(prisma: unknown) {
  return {
    ...(adminCtx(prisma) as unknown as Record<string, unknown>),
    user: { id: "cust1", role: "CUSTOMER", email: "c@x.test", depotId: null },
    session: {
      user: { id: "cust1", role: "CUSTOMER", email: "c@x.test", depotId: null },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin.modelRates (per-model pricing)", () => {
  it("happy path: returns models with tier counts", async () => {
    const prisma = makePrisma({
      findManyModels: [
        {
          id: "m1",
          make: "Honda",
          model: "CB125F",
          year: 2024,
          baseRate: new Prisma.Decimal(110),
          basePeriodHours: "H24",
          category: { id: "c1", name: "125cc" },
          _count: { vehicles: 3 },
        },
      ],
      findManyTiers: Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`,
        modelId: "m1",
        categoryId: null,
        vehicleId: null,
        minDays: 1 + i * 7,
        maxDays: 7 + i * 7,
        tierTotal: new Prisma.Decimal(0),
        tierMode: "PER_WEEK" as const,
        pricePerWeek: new Prisma.Decimal(168 - i * 8),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    });
    const caller = adminRouter.createCaller(adminCtx(prisma) as never);
    const result = await caller.modelRates();
    expect(result.models).toHaveLength(1);
    expect(result.tierCountByModel).toEqual({ m1: 5 });
    expect(result.tiersByModel.m1).toHaveLength(5);
  });

  it("rejects non-admin callers", async () => {
    const prisma = makePrisma();
    const caller = adminRouter.createCaller(customerCtx(prisma) as never);
    await expect(caller.modelRates()).rejects.toThrow();
  });
});

describe("admin.updateModelRates", () => {
  it("happy path: passes baseRate as a Decimal", async () => {
    const prisma = makePrisma();
    const caller = adminRouter.createCaller(adminCtx(prisma) as never);
    await caller.updateModelRates({ id: "m1", baseRate: 110, basePeriodHours: "H24" });
    expect(prisma.vehicleModel.update).toHaveBeenCalledTimes(1);
    const call = prisma.vehicleModel.update.mock.calls[0]![0];
    expect(call.where).toEqual({ id: "m1" });
    expect((call.data.baseRate as Prisma.Decimal).toString()).toBe("110");
    expect(call.data.basePeriodHours).toBe("H24");
  });

  it("clears baseRate when given null", async () => {
    const prisma = makePrisma();
    const caller = adminRouter.createCaller(adminCtx(prisma) as never);
    await caller.updateModelRates({ id: "m1", baseRate: null });
    const data = prisma.vehicleModel.update.mock.calls[0]![0].data;
    expect(data.baseRate).toBeNull();
  });

  it("rejects non-admin callers", async () => {
    const prisma = makePrisma();
    const caller = adminRouter.createCaller(customerCtx(prisma) as never);
    await expect(
      caller.updateModelRates({ id: "m1", baseRate: 110 }),
    ).rejects.toThrow();
  });
});

describe("admin.updateVehicleRateOverrides", () => {
  it("happy path: sets baseRateOverride + period override", async () => {
    const prisma = makePrisma();
    const caller = adminRouter.createCaller(adminCtx(prisma) as never);
    await caller.updateVehicleRateOverrides({
      id: "v1",
      baseRateOverride: 140,
      basePeriodHoursOverride: "H48",
    });
    expect(prisma.vehicle.update).toHaveBeenCalledTimes(1);
    const data = prisma.vehicle.update.mock.calls[0]![0].data;
    expect((data.baseRateOverride as Prisma.Decimal).toString()).toBe("140");
    expect(data.basePeriodHoursOverride).toBe("H48");
  });

  it("clears overrides when given null", async () => {
    const prisma = makePrisma();
    const caller = adminRouter.createCaller(adminCtx(prisma) as never);
    await caller.updateVehicleRateOverrides({
      id: "v1",
      baseRateOverride: null,
      basePeriodHoursOverride: null,
    });
    const data = prisma.vehicle.update.mock.calls[0]![0].data;
    expect(data.baseRateOverride).toBeNull();
    expect(data.basePeriodHoursOverride).toBeNull();
  });
});
