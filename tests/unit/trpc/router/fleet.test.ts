import { beforeEach, describe, expect, it, vi } from "vitest";
import { fleetRouter } from "../../../../src/server/trpc/router/fleet";

type Caller = ReturnType<typeof fleetRouter.createCaller>;

function makeCtx(over: { role?: "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN"; existingCount?: number } = {}) {
  const create = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "img1", ...data }),
  );
  const prisma = {
    vehicle: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "veh1" }) },
    vehicleImage: {
      count: vi.fn().mockResolvedValue(over.existingCount ?? 0),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create,
    },
  };
  const role = over.role ?? "STAFF";
  const ctx = {
    prisma,
    user: { id: "staff1", role },
    session: { user: { id: "staff1", role } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  } as unknown as Parameters<Caller["addVehicleImage"]>[0];
  return { ctx, prisma, create };
}

beforeEach(() => vi.clearAllMocks());

describe("fleet.addVehicleImage", () => {
  it("persists the content checksum so the model page can dedupe by it", async () => {
    const { ctx, create } = makeCtx();
    const caller = fleetRouter.createCaller(ctx as never);

    await caller.addVehicleImage({
      vehicleId: "veh1",
      url: "/uploads/vehicles/MTB-1/abc.png",
      checksum: "sha-deadbeef",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vehicleId: "veh1",
          url: "/uploads/vehicles/MTB-1/abc.png",
          checksum: "sha-deadbeef",
          isPrimary: true, // first image
          displayOrder: 0,
        }),
      }),
    );
  });

  it("accepts an image without a checksum (optional input)", async () => {
    const { ctx, create } = makeCtx();
    const caller = fleetRouter.createCaller(ctx as never);

    await caller.addVehicleImage({ vehicleId: "veh1", url: "/uploads/vehicles/MTB-1/abc.png" });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ checksum: undefined }) }),
    );
  });

  it("rejects an anonymous caller (staffProcedure)", async () => {
    const ctx = {
      prisma: {},
      user: null,
      session: null,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["addVehicleImage"]>[0];
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(
      caller.addVehicleImage({ vehicleId: "veh1", url: "/uploads/x.png" }),
    ).rejects.toThrow();
  });
});

describe("fleet depot scoping (B1 IDOR fix)", () => {
  function makeScopedCtx(role: "STAFF" | "MANAGER", depotId: string | null) {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { vehicle: { findMany } };
    const ctx = {
      prisma,
      user: { id: "u1", role, depotId },
      session: { user: { id: "u1", role, depotId } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["auditVehicles"]>[0];
    return { ctx, findMany };
  }

  it("auditVehicles pins depot-assigned STAFF to their own depot", async () => {
    const { ctx, findMany } = makeScopedCtx("STAFF", "depot-a");
    const caller = fleetRouter.createCaller(ctx as never);
    await caller.auditVehicles({ depotId: "depot-b" });
    const args = findMany.mock.calls[0]?.[0] as { where?: { depotId?: string } };
    expect(args?.where?.depotId).toBe("depot-a");
  });

  it("auditVehicles lets MANAGER+ filter any depot", async () => {
    const { ctx, findMany } = makeScopedCtx("MANAGER", "depot-a");
    const caller = fleetRouter.createCaller(ctx as never);
    await caller.auditVehicles({ depotId: "depot-b" });
    const args = findMany.mock.calls[0]?.[0] as { where?: { depotId?: string } };
    expect(args?.where?.depotId).toBe("depot-b");
  });

  it("attentionList scopes depot-assigned STAFF to their own depot", async () => {
    const { ctx, findMany } = makeScopedCtx("STAFF", "depot-a");
    const caller = fleetRouter.createCaller(ctx as never);
    await caller.attentionList({ page: 1, pageSize: 25, sortBy: "dueDate", sortDir: "asc" });
    const args = findMany.mock.calls[0]?.[0] as { where?: { depotId?: string } };
    expect(args?.where?.depotId).toBe("depot-a");
  });
});
