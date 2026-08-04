import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mirror test for src/server/trpc/router/depot.ts.
 *
 * Both procedures are `publicProcedure` (the booking wizard and marketing
 * pages call them anonymously), so there is no role gate to assert — the
 * "no session still works" specs below pin that as deliberate. Failure
 * coverage is the NOT_FOUND branch, the Zod bounds and a DB fault.
 */

// `cached` would otherwise hit a live dev Redis (REDIS_URL in the shell) and
// serve a stale hit, swallowing the prisma call these specs assert on.
const { cachedMock } = vi.hoisted(() => ({
  cachedMock: vi.fn(
    async (_key: string, _ttlSec: number, fn: () => Promise<unknown>, _tags?: readonly string[]) =>
      fn(),
  ),
}));
vi.mock("@/lib/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cache")>();
  return { ...actual, cached: cachedMock };
});

// getForecast reaches Open-Meteo over the network; MSW is set to error on any
// unhandled request, so it must be stubbed rather than merely intercepted.
vi.mock("@/lib/weather", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/weather")>();
  return { ...actual, getForecast: vi.fn() };
});

import { depotRouter } from "@/server/trpc/router/depot";
import { getForecast, type WeatherForecast } from "@/lib/weather";
import { CACHE_TAGS } from "@/lib/cache-tags";

type Ctx = Parameters<typeof depotRouter.createCaller>[0];

const DEPOT = {
  id: "d1",
  name: "Brisbane CBD",
  slug: "brisbane-cbd",
  latitude: -27.4705,
  longitude: 153.026,
  timezone: "Australia/Brisbane",
  isActive: true,
  deletedAt: null,
  operatingHours: [{ id: "oh1", dayOfWeek: 1, openTime: "08:00", closeTime: "17:00" }],
};

const FORECAST: WeatherForecast = {
  latitude: -27.4705,
  longitude: 153.026,
  timezone: "Australia/Brisbane",
  daily: [
    {
      date: "2026-08-05",
      tempMaxC: 24,
      tempMinC: 11,
      precipitationMm: 0,
      precipitationProbability: 5,
      weatherCode: 0,
      summary: "Clear sky",
    },
  ],
};

function makeCtx(
  over: { depots?: unknown[]; depot?: unknown; anon?: boolean; findManyError?: Error } = {},
) {
  const findMany = over.findManyError
    ? vi.fn().mockRejectedValue(over.findManyError)
    : vi.fn().mockResolvedValue(over.depots ?? [DEPOT]);
  const findUnique = vi.fn().mockResolvedValue("depot" in over ? over.depot : DEPOT);
  const prisma = { depot: { findMany, findUnique } };
  const user = { id: "staff1", email: "staff@xpert.test", role: "STAFF", depotId: null };
  const ctx = {
    prisma,
    user: over.anon ? null : user,
    session: over.anon ? null : { user },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
    headers: undefined,
  } as unknown as Ctx;
  return { ctx, caller: depotRouter.createCaller(ctx), findMany, findUnique };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getForecast).mockResolvedValue(FORECAST);
});

describe("depot.list", () => {
  it("returns active, non-deleted depots with their operating hours, name-ordered", async () => {
    const { caller, findMany } = makeCtx();

    const result = await caller.list();

    expect(result).toEqual([DEPOT]);
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: "asc" },
      include: { operatingHours: true },
    });
  });

  it("wraps the query in the shared cache under the depots tag", async () => {
    const { caller } = makeCtx();

    await caller.list();

    const [key, ttlSec, , tags] = cachedMock.mock.calls[0] ?? [];
    expect(key).toBe("depot:list:active");
    expect(ttlSec).toBe(3600);
    expect(tags).toEqual([CACHE_TAGS.DEPOTS]);
  });

  it("serves a cache hit without touching the database", async () => {
    const { caller, findMany } = makeCtx();
    cachedMock.mockImplementationOnce(async () => [{ id: "cached-depot" }]);

    const result = await caller.list();

    expect(result).toEqual([{ id: "cached-depot" }]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("is callable without a session (publicProcedure)", async () => {
    const { caller } = makeCtx({ anon: true });

    await expect(caller.list()).resolves.toEqual([DEPOT]);
  });

  it("propagates a database failure instead of returning a partial list", async () => {
    const { caller } = makeCtx({ findManyError: new Error("connection lost") });

    await expect(caller.list()).rejects.toThrow("connection lost");
  });
});

describe("depot.forecast", () => {
  it("forecasts against the depot's coordinates and timezone", async () => {
    const { caller, findUnique } = makeCtx();

    const result = await caller.forecast({ depotId: "d1", days: 3 });

    expect(result).toEqual(FORECAST);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "d1" },
      select: { latitude: true, longitude: true, timezone: true },
    });
    expect(getForecast).toHaveBeenCalledWith(DEPOT.latitude, DEPOT.longitude, {
      days: 3,
      timezone: "Australia/Brisbane",
    });
  });

  it("defaults to a 7-day window", async () => {
    const { caller } = makeCtx();

    await caller.forecast({ depotId: "d1" });

    expect(getForecast).toHaveBeenCalledWith(
      DEPOT.latitude,
      DEPOT.longitude,
      expect.objectContaining({ days: 7 }),
    );
  });

  it("treats a 0,0 coordinate as valid (null check, not falsy check)", async () => {
    const { caller } = makeCtx({
      depot: { latitude: 0, longitude: 0, timezone: "Australia/Brisbane" },
    });

    await expect(caller.forecast({ depotId: "d1" })).resolves.toEqual(FORECAST);
    expect(getForecast).toHaveBeenCalledWith(0, 0, expect.anything());
  });

  it("is callable without a session (publicProcedure)", async () => {
    const { caller } = makeCtx({ anon: true });

    await expect(caller.forecast({ depotId: "d1" })).resolves.toEqual(FORECAST);
  });

  it("returns null when the upstream weather API is unavailable", async () => {
    vi.mocked(getForecast).mockResolvedValue(null);
    const { caller } = makeCtx();

    await expect(caller.forecast({ depotId: "d1" })).resolves.toBeNull();
  });

  it("throws NOT_FOUND for an unknown depot", async () => {
    const { caller } = makeCtx({ depot: null });

    await expect(caller.forecast({ depotId: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(getForecast).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the depot has no coordinates", async () => {
    const { caller } = makeCtx({
      depot: { latitude: -27.47, longitude: null, timezone: "Australia/Brisbane" },
    });

    await expect(caller.forecast({ depotId: "d1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(getForecast).not.toHaveBeenCalled();
  });

  it("still forecasts for a soft-deleted or inactive depot (current behaviour)", async () => {
    // Unlike `list`, the lookup is not filtered on isActive / deletedAt.
    const { caller } = makeCtx({
      depot: { latitude: -27.47, longitude: 153.02, timezone: "Australia/Brisbane" },
    });

    await expect(caller.forecast({ depotId: "archived" })).resolves.toEqual(FORECAST);
  });

  it("rejects a day count outside 1–14 or a fractional one (Zod)", async () => {
    const { caller, findUnique } = makeCtx();

    await expect(caller.forecast({ depotId: "d1", days: 0 })).rejects.toThrow();
    await expect(caller.forecast({ depotId: "d1", days: 15 })).rejects.toThrow();
    await expect(caller.forecast({ depotId: "d1", days: 1.5 })).rejects.toThrow();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects a missing depotId (Zod)", async () => {
    const { caller } = makeCtx();

    await expect(
      caller.forecast({} as unknown as { depotId: string }),
    ).rejects.toThrow();
  });
});
