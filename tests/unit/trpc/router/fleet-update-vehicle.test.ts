import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { fleetRouter } from "../../../../src/server/trpc/router/fleet";

type Caller = ReturnType<typeof fleetRouter.createCaller>;

const BASE_VEHICLE = {
  id: "veh1",
  internalCode: "SCT-001",
  rego: "ABC123",
  regoState: "QLD",
  vin: null,
  engineNumber: null,
  make: "Honda",
  model: "PCX150",
  year: 2024,
  colour: "Red",
  fuelType: "Petrol",
  currentOdometerKm: 1200,
  categoryId: "cat1",
  depotId: "dep1",
  condition: "GOOD",
  status: "AVAILABLE",
  regoExpiry: new Date("2026-12-01"),
  ctpExpiry: null,
  insuranceExpiry: null,
  insurancePolicyNumber: null,
  lastServiceDate: null,
  lastServiceKm: null,
  nextServiceDueDate: null,
  nextServiceDueKm: null,
  warrantyExpiry: null,
  purchasePrice: 5000,
  purchaseDate: new Date("2024-01-01"),
  depreciationMethod: "STRAIGHT_LINE",
  depreciationRate: 20,
  currentBookValue: 5000,
};

function makeCtx(over: { vehicle?: Record<string, unknown>; internalCodeDup?: boolean } = {}) {
  const vehicle = { ...BASE_VEHICLE, ...over.vehicle };

  const auditLogCreate = vi.fn().mockResolvedValue({});
  const vehicleUpdate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...vehicle, ...data }),
  );
  const tx = {
    vehicle: { update: vehicleUpdate },
    auditLog: { create: auditLogCreate },
  };

  const prisma = {
    vehicle: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id?: string; internalCode?: string } }) => {
        if (where.internalCode) {
          return Promise.resolve(over.internalCodeDup ? { id: "other", internalCode: where.internalCode } : null);
        }
        return Promise.resolve(where.id === vehicle.id ? vehicle : null);
      }),
    },
    vehicleCategory: {
      findUnique: vi.fn().mockResolvedValue({ id: "cat2" }),
    },
    depot: {
      findUnique: vi.fn().mockResolvedValue({ id: "dep2" }),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  return {
    ctx: {
      prisma,
      user: { id: "manager1", role: "MANAGER" as const },
      session: { user: { id: "manager1", role: "MANAGER" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["updateVehicle"]>[0],
    auditLogCreate,
    vehicleUpdate,
  };
}

function caller(ctx: unknown): Caller {
  return fleetRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fleet.updateVehicle", () => {
  it("updates only the fields that changed and writes an audit log diff", async () => {
    const { ctx, auditLogCreate, vehicleUpdate } = makeCtx();
    const c = caller(ctx);

    const result = await c.updateVehicle({
      id: "veh1",
      colour: "Blue",
      year: 2024,
      currentOdometerKm: 1500,
    });

    expect(vehicleUpdate).toHaveBeenCalledTimes(1);
    const updateArg = vehicleUpdate.mock.calls[0]![0] as { where: { id: string }; data: Record<string, unknown> };
    expect(updateArg.where).toEqual({ id: "veh1" });
    expect(updateArg.data).toEqual({ colour: "Blue", year: 2024, currentOdometerKm: 1500 });

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    const auditArg = (auditLogCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(auditArg.action).toBe("VEHICLE_UPDATED");
    expect(auditArg.entity).toBe("Vehicle");
    expect(auditArg.entityId).toBe("veh1");
    expect(auditArg.previousData).toEqual({ colour: "Red", currentOdometerKm: 1200 });
    expect(auditArg.newData).toEqual({ colour: "Blue", currentOdometerKm: 1500 });

    expect(result.colour).toBe("Blue");
  });

  it("is a no-op when no fields actually differ", async () => {
    const { ctx, auditLogCreate, vehicleUpdate } = makeCtx();
    const c = caller(ctx);

    await c.updateVehicle({ id: "veh1", colour: "Red", make: "Honda" });

    expect(vehicleUpdate).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("mirrors currentBookValue to purchasePrice when purchasePrice changes", async () => {
    const { ctx, vehicleUpdate } = makeCtx();
    const c = caller(ctx);

    await c.updateVehicle({ id: "veh1", purchasePrice: 6500 });

    const updateArg = vehicleUpdate.mock.calls[0]![0] as { where: { id: string }; data: Record<string, unknown> };
    expect(updateArg.data.purchasePrice).toBe(6500);
    expect(updateArg.data.currentBookValue).toBe(6500);
  });

  it("rejects duplicate internalCode with CONFLICT", async () => {
    const { ctx } = makeCtx({ internalCodeDup: true });
    const c = caller(ctx);

    await expect(
      c.updateVehicle({ id: "veh1", internalCode: "SCT-999" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects when vehicle does not exist", async () => {
    const { ctx } = makeCtx();
    const c = caller(ctx);

    await expect(
      c.updateVehicle({ id: "missing", colour: "Blue" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
