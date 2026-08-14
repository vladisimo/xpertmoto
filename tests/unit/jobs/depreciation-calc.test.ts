import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    vehicle: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("../../../src/server/jobs/queue", () => ({
  getQueue: vi.fn(() => null),
  registerWorker: vi.fn(),
}));
const calcDepreciationMock = vi.fn();
vi.mock("../../../src/server/services/depreciation", () => ({
  calcDepreciation: (...a: unknown[]) => calcDepreciationMock(...a),
}));

import { runDepreciation } from "../../../src/server/jobs/depreciation-calc";
import { prisma } from "../../../src/lib/prisma";

type MockFn = ReturnType<typeof vi.fn>;
const mockedFindMany = prisma.vehicle.findMany as unknown as MockFn;
const mockedUpdate = prisma.vehicle.update as unknown as MockFn;

function makeVehicle(id = "veh1") {
  return {
    id,
    purchasePrice: 8000,
    purchaseDate: new Date("2025-01-01"),
    depreciationMethod: "STRAIGHT_LINE",
    depreciationRate: 20,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUpdate.mockResolvedValue({});
  calcDepreciationMock.mockReturnValue({ bookValue: 6400 });
});

describe("depreciation-calc monthly job", () => {
  it("excludes disposed and soft-deleted vehicles — book value freezes at disposition", async () => {
    mockedFindMany.mockResolvedValue([]);

    await runDepreciation();

    // The query itself must fence out SOLD / END_OF_LIFE / STOLEN /
    // WRITTEN_OFF and deleted rows: their last computed currentBookValue is
    // the figure insurance claims and loss accounting rely on.
    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { notIn: ["SOLD", "END_OF_LIFE", "STOLEN", "WRITTEN_OFF"] },
          deletedAt: null,
        }),
      }),
    );
  });

  it("recalculates book value for every configured in-fleet vehicle", async () => {
    mockedFindMany.mockResolvedValue([makeVehicle("veh1"), makeVehicle("veh2")]);

    const updated = await runDepreciation();

    expect(updated).toBe(2);
    expect(mockedUpdate).toHaveBeenCalledTimes(2);
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: "veh1" },
      data: { currentBookValue: 6400 },
    });
  });
});
