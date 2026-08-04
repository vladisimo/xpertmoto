import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogRouter } from "../../../../src/server/trpc/router/catalog";
import { CACHE_TAGS } from "../../../../src/lib/cache-tags";
import { CATEGORY_HAS_RENTABLE_VEHICLE } from "../../../../src/lib/fleet/consumer-visibility";

/**
 * The catalog router feeds the public booking wizard: add-ons, insurance
 * options and the category picker. Every procedure is a `publicProcedure`
 * query with no input, so the contract worth pinning is (a) the where/orderBy/
 * select each one sends to prisma, (b) that an anonymous visitor is served,
 * and (c) the cache key/TTL/tag wiring that decides when the list goes stale.
 */

const { cacheSpy } = vi.hoisted(() => ({ cacheSpy: vi.fn() }));

// Pass-through cache. Unit tests must never read the developer's real Redis —
// a hit would serve a previous run's payload and swallow the prisma call these
// specs assert on. The spy records (key, ttlSec, tags) so the cache contract
// stays covered even though the read/write path itself is stubbed out.
vi.mock("@/lib/cache", () => ({
  cached: <T>(key: string, ttlSec: number, fn: () => Promise<T>, tags?: readonly string[]) => {
    cacheSpy(key, ttlSec, tags);
    return fn();
  },
}));

type Ctx = Parameters<typeof catalogRouter.createCaller>[0];

function makeCtx(
  over: {
    addons?: unknown[];
    insurance?: unknown[];
    categories?: unknown[];
    session?: unknown;
  } = {},
) {
  const prisma = {
    addon: { findMany: vi.fn().mockResolvedValue(over.addons ?? []) },
    insuranceOption: { findMany: vi.fn().mockResolvedValue(over.insurance ?? []) },
    vehicleCategory: { findMany: vi.fn().mockResolvedValue(over.categories ?? []) },
  };
  const ctx = {
    prisma,
    // Anonymous by default: the wizard reads the catalog before the visitor
    // has signed in, so `session: null` is the primary calling shape.
    session: over.session ?? null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  } as unknown as Ctx;
  return { ctx, prisma };
}

beforeEach(() => vi.clearAllMocks());

describe("catalog.addons", () => {
  const ADDONS = [
    { id: "a1", name: "Helmet", type: "EQUIPMENT", dailyRate: "5.00", isActive: true },
    { id: "a2", name: "Top box", type: "EQUIPMENT", dailyRate: "3.00", isActive: true },
  ];

  it("returns the active add-ons ordered by name", async () => {
    const { ctx, prisma } = makeCtx({ addons: ADDONS });
    const caller = catalogRouter.createCaller(ctx);

    const result = await caller.addons();

    expect(result).toEqual(ADDONS);
    expect(prisma.addon.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
  });

  it("is public — an anonymous visitor is served, not rejected", async () => {
    const { ctx } = makeCtx({ session: null });
    const caller = catalogRouter.createCaller(ctx);

    await expect(caller.addons()).resolves.toEqual([]);
  });

  it("surfaces a database failure instead of degrading to an empty list", async () => {
    const { ctx, prisma } = makeCtx();
    prisma.addon.findMany.mockRejectedValue(new Error("db down"));
    const caller = catalogRouter.createCaller(ctx);

    await expect(caller.addons()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("catalog.insurance", () => {
  const OPTIONS = [
    { id: "i1", name: "Basic", dailyRate: "12.00", excessAmount: "1500.00", isActive: true },
    { id: "i2", name: "Premium", dailyRate: "29.00", excessAmount: "500.00", isActive: true },
  ];

  it("returns the active options cheapest-first so the wizard can default to Basic", async () => {
    const { ctx, prisma } = makeCtx({ insurance: OPTIONS });
    const caller = catalogRouter.createCaller(ctx);

    const result = await caller.insurance();

    expect(result).toEqual(OPTIONS);
    expect(prisma.insuranceOption.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { dailyRate: "asc" },
    });
  });

  it("is public — an anonymous visitor is served, not rejected", async () => {
    const { ctx } = makeCtx({ session: null });
    const caller = catalogRouter.createCaller(ctx);

    await expect(caller.insurance()).resolves.toEqual([]);
  });

  it("surfaces a database failure instead of degrading to an empty list", async () => {
    const { ctx, prisma } = makeCtx();
    prisma.insuranceOption.findMany.mockRejectedValue(new Error("db down"));
    const caller = catalogRouter.createCaller(ctx);

    await expect(caller.insurance()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("catalog.listCategories", () => {
  const CATEGORIES = [
    { id: "c1", name: "Scooter", slug: "scooter" },
    { id: "c2", name: "Motorbike", slug: "motorbike" },
  ];

  it("returns active categories in display order", async () => {
    const { ctx, prisma } = makeCtx({ categories: CATEGORIES });
    const caller = catalogRouter.createCaller(ctx);

    const result = await caller.listCategories();

    expect(result).toEqual(CATEGORIES);
    const args = prisma.vehicleCategory.findMany.mock.calls[0]?.[0] as {
      where?: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      select?: Record<string, unknown>;
    };
    expect(args?.where).toMatchObject({ isActive: true });
    expect(args?.orderBy).toEqual({ displayOrder: "asc" });
  });

  it("hides categories with no rentable, active unit (consumer-visibility rule)", async () => {
    const { ctx, prisma } = makeCtx();
    const caller = catalogRouter.createCaller(ctx);

    await caller.listCategories();

    const args = prisma.vehicleCategory.findMany.mock.calls[0]?.[0] as {
      where?: Record<string, unknown>;
    };
    // Internal/service vehicles (isRentable: false) must never put a category
    // in front of a customer — the shared where-clause is spread in verbatim.
    expect(args?.where).toMatchObject(CATEGORY_HAS_RENTABLE_VEHICLE);
  });

  it("selects only the public id/name/slug triple", async () => {
    const { ctx, prisma } = makeCtx();
    const caller = catalogRouter.createCaller(ctx);

    await caller.listCategories();

    const args = prisma.vehicleCategory.findMany.mock.calls[0]?.[0] as {
      select?: Record<string, unknown>;
    };
    expect(args?.select).toEqual({ id: true, name: true, slug: true });
  });

  it("is public — an anonymous visitor is served, not rejected", async () => {
    const { ctx } = makeCtx({ session: null });
    const caller = catalogRouter.createCaller(ctx);

    await expect(caller.listCategories()).resolves.toEqual([]);
  });

  it("surfaces a database failure instead of degrading to an empty list", async () => {
    const { ctx, prisma } = makeCtx();
    prisma.vehicleCategory.findMany.mockRejectedValue(new Error("db down"));
    const caller = catalogRouter.createCaller(ctx);

    await expect(caller.listCategories()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("catalog cache contract", () => {
  const HOUR = 3600;

  it.each([
    ["addons", "catalog:addons:active"],
    ["insurance", "catalog:insurance:active"],
    ["listCategories", "catalog:categories:active"],
  ] as const)(
    "%s caches under its own key for an hour, tagged CATEGORIES",
    async (procedure, key) => {
      const { ctx } = makeCtx();
      const caller = catalogRouter.createCaller(ctx);

      await caller[procedure]();

      // All three ride the one tag, so an admin edit to any catalogue entity
      // invalidates the whole public catalog in a single invalidateTag call.
      expect(cacheSpy).toHaveBeenCalledWith(key, HOUR, [CACHE_TAGS.CATEGORIES]);
    },
  );
});
