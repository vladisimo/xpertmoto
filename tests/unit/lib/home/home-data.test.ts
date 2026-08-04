import { describe, it, expect, vi, beforeEach } from "vitest";

const modelFindMany = vi.fn();
const depotFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    vehicleModel: { findMany: (...a: unknown[]) => modelFindMany(...a) },
    depot: { findMany: (...a: unknown[]) => depotFindMany(...a) },
  },
}));

beforeEach(() => {
  modelFindMany.mockReset();
  depotFindMany.mockReset();
});

// A model row shaped like the Prisma select in getFleetPreview. `baseDailyRate`
// is a Prisma.Decimal in production — represented here by an object exposing
// `.toNumber()`, which is all the mapper touches.
function modelRow(
  overrides: Partial<{
    id: string;
    primaryImageUrl: string | null;
    availableStatuses: string[];
    baseDailyRate: number | null;
    category: unknown;
  }> = {},
) {
  const {
    id = "m1",
    primaryImageUrl = "https://cdn.test/bike.jpg",
    availableStatuses = ["AVAILABLE", "MAINTENANCE"],
    baseDailyRate = 120,
    category = baseDailyRate == null
      ? null
      : { id: "cat1", licenceRequired: "R", baseDailyRate: { toNumber: () => baseDailyRate } },
  } = overrides;
  return {
    id,
    slug: `${id}-slug`,
    make: "Yamaha",
    model: "MT-07",
    year: 2024,
    tagline: "Naked sport",
    useCases: ["COMMUTER"],
    riderLevels: ["INTERMEDIATE"],
    category,
    vehicles: availableStatuses.map((status) => ({
      status,
      images: primaryImageUrl ? [{ url: primaryImageUrl }] : [],
    })),
  };
}

describe("getFleetPreview", () => {
  it("maps rows, counts AVAILABLE vehicles and converts the rate to a number", async () => {
    modelFindMany.mockResolvedValue([modelRow()]);
    const { getFleetPreview } = await import("@/lib/home/home-data");
    const result = await getFleetPreview();
    expect(result).toHaveLength(1);
    const m = result[0]!;
    expect(m).toMatchObject({
      id: "m1",
      slug: "m1-slug",
      availableCount: 1, // only the AVAILABLE vehicle counts, not MAINTENANCE
      primaryImageUrl: "https://cdn.test/bike.jpg",
      category: { id: "cat1", licenceRequired: "R", baseDailyRate: 120 },
    });
    expect(typeof m.category.baseDailyRate).toBe("number");
  });

  it("drops models that have no primary image", async () => {
    modelFindMany.mockResolvedValue([
      modelRow({ id: "with-img", primaryImageUrl: "https://cdn.test/a.jpg" }),
      modelRow({ id: "no-img", primaryImageUrl: null }),
    ]);
    const { getFleetPreview } = await import("@/lib/home/home-data");
    const result = await getFleetPreview();
    expect(result.map((m) => m.id)).toEqual(["with-img"]);
  });

  it("defaults rate to 0 and licence to '' when the category is missing", async () => {
    modelFindMany.mockResolvedValue([modelRow({ baseDailyRate: null })]);
    const { getFleetPreview } = await import("@/lib/home/home-data");
    const result = await getFleetPreview();
    expect(result).toHaveLength(1);
    const m = result[0]!;
    expect(m.category).toEqual({ id: "", licenceRequired: "", baseDailyRate: 0 });
  });
});

describe("getHomeDepots", () => {
  it("queries only active, non-deleted depots and returns the rows", async () => {
    const rows = [{ id: "d1", name: "Sydney" }];
    depotFindMany.mockResolvedValue(rows);
    const { getHomeDepots } = await import("@/lib/home/home-data");
    const result = await getHomeDepots();
    expect(result).toBe(rows);
    expect(depotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, deletedAt: null } }),
    );
  });
});
