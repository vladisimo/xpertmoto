import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  vehicleModelRouter,
  type UpdateClassificationInput,
} from "@/server/trpc/router/vehicleModel";

function makePrisma(found: Record<string, unknown> | null = { id: "m1" }) {
  return {
    vehicleModel: {
      findUnique: vi.fn().mockResolvedValue(found),
      update: vi.fn().mockResolvedValue({ id: "m1" }),
    },
  };
}

function staffCtx(prisma: unknown) {
  const user = {
    id: "staff1",
    email: "staff@xpert.test",
    name: "Staff",
    role: "STAFF",
    depotId: null,
  };
  return {
    prisma,
    user,
    session: { user },
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
    headers: undefined,
  } as never;
}

function anonCtx(prisma: unknown) {
  return {
    prisma,
    user: null,
    session: null,
    reqId: "r1",
    headers: undefined,
  } as never;
}

const VALID_INPUT: UpdateClassificationInput = {
  id: "m1",
  bikeTypes: ["SPORT", "NAKED"],
  riderLevels: ["BEGINNER"],
  useCases: ["COMMUTING"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("vehicleModel.updateClassification", () => {
  it("happy path: sets the three taxonomy arrays", async () => {
    const prisma = makePrisma();
    const caller = vehicleModelRouter.createCaller(staffCtx(prisma));
    const res = await caller.updateClassification({ ...VALID_INPUT });

    expect(res).toEqual({ ok: true });
    const args = prisma.vehicleModel.update.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: "m1" });
    expect(args?.data).toEqual({
      bikeTypes: ["SPORT", "NAKED"],
      riderLevels: ["BEGINNER"],
      useCases: ["COMMUTING"],
    });
  });

  it("does NOT touch specsFetchedAt or specsConfidence (classification != spec edit)", async () => {
    const prisma = makePrisma();
    const caller = vehicleModelRouter.createCaller(staffCtx(prisma));
    await caller.updateClassification({ ...VALID_INPUT });

    const data = prisma.vehicleModel.update.mock.calls[0]?.[0]?.data ?? {};
    expect(data).not.toHaveProperty("specsFetchedAt");
    expect(data).not.toHaveProperty("specsConfidence");
  });

  it("throws NOT_FOUND for an unknown model", async () => {
    const prisma = makePrisma(null);
    const caller = vehicleModelRouter.createCaller(staffCtx(prisma));
    await expect(caller.updateClassification({ ...VALID_INPUT })).rejects.toThrow(TRPCError);
    expect(prisma.vehicleModel.update).not.toHaveBeenCalled();
  });

  it("rejects anonymous callers (staffProcedure gate)", async () => {
    const prisma = makePrisma();
    const caller = vehicleModelRouter.createCaller(anonCtx(prisma));
    await expect(caller.updateClassification({ ...VALID_INPUT })).rejects.toThrow();
    expect(prisma.vehicleModel.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalid bike-type enum value (Zod)", async () => {
    const prisma = makePrisma();
    const caller = vehicleModelRouter.createCaller(staffCtx(prisma));
    await expect(
      caller.updateClassification({
        ...VALID_INPUT,
        bikeTypes: ["MONSTER_TRUCK"] as never,
      }),
    ).rejects.toThrow();
    expect(prisma.vehicleModel.update).not.toHaveBeenCalled();
  });
});
