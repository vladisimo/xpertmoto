import { describe, expect, it, vi } from "vitest";
import { vehicleRouter } from "../../../../src/server/trpc/router/vehicle";

type Caller = ReturnType<typeof vehicleRouter.createCaller>;

function makeCtx(found: Record<string, unknown> | null = { id: "v1" }) {
  const findUnique = vi.fn().mockResolvedValue(found);
  const prisma = {
    vehicle: { findUnique, findMany: vi.fn() },
    vehicleCategory: { findMany: vi.fn() },
    vehicleModel: { findMany: vi.fn(), findUnique: vi.fn() },
  };
  const ctx = {
    prisma,
    session: null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  } as unknown as Parameters<Caller["byId"]>[0];
  return { ctx, findUnique, prisma };
}

function makeModelCtx() {
  const findMany = vi.fn();
  const findUnique = vi.fn();
  const prisma = {
    vehicle: { findUnique: vi.fn(), findMany: vi.fn() },
    vehicleCategory: { findMany: vi.fn() },
    vehicleModel: { findMany, findUnique },
  };
  const ctx = {
    prisma,
    session: null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  };
  return { ctx: ctx as never, findMany, findUnique };
}

describe("vehicle.byId", () => {
  it("includes catalogueModel with documents so the spec sheet can render", async () => {
    const { ctx, findUnique } = makeCtx();
    const caller = vehicleRouter.createCaller(ctx as never);
    await caller.byId({ id: "v1" });
    const args = findUnique.mock.calls[0]?.[0];
    expect(args?.include?.catalogueModel).toMatchObject({
      include: { documents: true },
    });
  });

  it("returns images ordered with the primary first", async () => {
    const { ctx, findUnique } = makeCtx();
    const caller = vehicleRouter.createCaller(ctx as never);
    await caller.byId({ id: "v1" });
    const args = findUnique.mock.calls[0]?.[0];
    expect(args?.include?.images).toMatchObject({
      orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }],
    });
  });
});

describe("vehicle.listModels", () => {
  it("filters by the requested use case and only active-vehicle models", async () => {
    const { ctx, findMany } = makeModelCtx();
    findMany.mockResolvedValue([]);
    const caller = vehicleRouter.createCaller(ctx);
    await caller.listModels({ useCase: "ADVENTURE" });

    const args = findMany.mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({
      isRentable: true,
      vehicles: { some: { isActive: true } },
      useCases: { has: "ADVENTURE" },
    });
  });

  it("computes availableCount, primaryImageUrl and sorts by availability desc", async () => {
    const { ctx, findMany } = makeModelCtx();
    findMany.mockResolvedValue([
      {
        id: "a",
        slug: "alpha",
        make: "Alpha",
        model: "A1",
        year: 2024,
        tagline: null,
        useCases: ["ADVENTURE"],
        heroImageKey: null,
        engineCapacityCc: 500,
        enginePowerKw: null,
        seatHeightMm: 800,
        fuelType: "Petrol",
        category: { id: "c1", slug: "x", name: "X", licenceRequired: "R", minAge: 18, baseDailyRate: {} as never, baseWeeklyRate: {} as never, bondAmount: {} as never },
        vehicles: [
          { id: "v1", status: "AVAILABLE", images: [{ url: "https://img/one.jpg" }] },
          { id: "v2", status: "RENTED", images: [] },
        ],
      },
      {
        id: "b",
        slug: "beta",
        make: "Beta",
        model: "B1",
        year: 2024,
        tagline: null,
        useCases: ["ADVENTURE"],
        heroImageKey: null,
        engineCapacityCc: 600,
        enginePowerKw: null,
        seatHeightMm: 810,
        fuelType: "Petrol",
        category: { id: "c1", slug: "x", name: "X", licenceRequired: "R", minAge: 18, baseDailyRate: {} as never, baseWeeklyRate: {} as never, bondAmount: {} as never },
        vehicles: [
          { id: "v3", status: "AVAILABLE", images: [{ url: "https://img/two.jpg" }] },
          { id: "v4", status: "AVAILABLE", images: [] },
          { id: "v5", status: "AVAILABLE", images: [] },
        ],
      },
    ]);
    const caller = vehicleRouter.createCaller(ctx);
    const result = await caller.listModels({ useCase: "ADVENTURE" });
    expect(result.map((m) => m.slug)).toEqual(["beta", "alpha"]);
    expect(result[0]).toMatchObject({ availableCount: 3, primaryImageUrl: "https://img/two.jpg" });
    expect(result[1]).toMatchObject({ availableCount: 1, primaryImageUrl: "https://img/one.jpg" });
  });
});

describe("vehicle.modelBySlug", () => {
  it("throws NOT_FOUND when slug does not match", async () => {
    const { ctx, findUnique } = makeModelCtx();
    findUnique.mockResolvedValue(null);
    const caller = vehicleRouter.createCaller(ctx);
    await expect(caller.modelBySlug({ slug: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws NOT_FOUND when the model has no active vehicles", async () => {
    const { ctx, findUnique } = makeModelCtx();
    findUnique.mockResolvedValue({
      id: "m1",
      slug: "m",
      make: "M",
      model: "M1",
      year: 2024,
      tagline: null,
      useCases: [],
      category: null,
      vehicles: [],
    });
    const caller = vehicleRouter.createCaller(ctx);
    await expect(caller.modelBySlug({ slug: "m" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("dedupes images, computes counts, and picks first available vehicle", async () => {
    const { ctx, findUnique } = makeModelCtx();
    findUnique.mockResolvedValue({
      id: "m1",
      slug: "m",
      make: "M",
      model: "M1",
      year: 2024,
      tagline: null,
      useCases: ["ADVENTURE"],
      category: { id: "c1" },
      documents: [],
      vehicles: [
        {
          id: "v1",
          status: "AVAILABLE",
          currentOdometerKm: 1200,
          depot: { id: "d1", name: "Surfers Paradise", slug: "surfers", state: "QLD" },
          images: [
            { id: "i1", url: "https://img/a.jpg", caption: null, isPrimary: true },
            { id: "i2", url: "https://img/b.jpg", caption: null, isPrimary: false },
          ],
        },
        {
          id: "v2",
          status: "AVAILABLE",
          currentOdometerKm: 5000,
          depot: { id: "d1", name: "Surfers Paradise", slug: "surfers", state: "QLD" },
          images: [{ id: "i3", url: "https://img/a.jpg", caption: null, isPrimary: true }],
        },
        {
          id: "v3",
          status: "RENTED",
          currentOdometerKm: 1,
          depot: { id: "d2", name: "Byron Bay", slug: "byron", state: "NSW" },
          images: [],
        },
      ],
    });

    const caller = vehicleRouter.createCaller(ctx);
    const result = await caller.modelBySlug({ slug: "m" });

    expect(result.images.map((i) => i.url)).toEqual(["https://img/a.jpg", "https://img/b.jpg"]);
    expect(result.availableCount).toBe(2);
    expect(result.inventoryCount).toBe(3);
    expect(result.firstAvailableVehicleId).toBe("v1");
    expect(result.depotsWithStock).toEqual([
      expect.objectContaining({ id: "d1", availableCount: 2 }),
    ]);
  });
});
