import { describe, expect, it, vi } from "vitest";
import {
  autoCloseByTarget,
  claimTask,
  manualComplete,
  abandonTask,
} from "../../../src/server/services/staff-tasks";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import type { PrismaLike } from "../../../src/server/services/staff-ops-signals";

type Activity = {
  id: string;
  taskType: string;
  targetEntityKind: string;
  targetEntityId: string;
  staffId: string;
  status: "IN_PROGRESS" | "COMPLETED" | "SUPERSEDED" | "ABANDONED";
};

function mkDb(rows: Activity[]) {
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  const update = vi.fn(async (args: { where: { id: string }; data: Partial<Activity> & { completedAt?: Date; outcome?: string; outcomeNote?: string } }) => {
    const row = byId.get(args.where.id);
    if (!row) throw new Error("not found");
    Object.assign(row, args.data);
    return row;
  });
  const create = vi.fn(async () => ({ id: "new", ...rows[0] }));
  return {
    db: {
      staffTaskActivity: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          const where = args.where as { targetEntityKind?: string; targetEntityId?: string; status?: string; taskType?: { in: string[] } };
          return rows.filter((r) => {
            if (where.targetEntityKind && r.targetEntityKind !== where.targetEntityKind) return false;
            if (where.targetEntityId && r.targetEntityId !== where.targetEntityId) return false;
            if (where.status && r.status !== where.status) return false;
            if (where.taskType && !where.taskType.in.includes(r.taskType)) return false;
            return true;
          });
        },
        findUnique: async (args: { where: { id: string } }) => byId.get(args.where.id) ?? null,
        update,
        updateMany: async () => ({ count: 0 }),
        create,
      },
    } as unknown as PrismaLike,
    update,
    create,
    byId,
  };
}

describe("autoCloseByTarget", () => {
  it("marks COMPLETED when the claimant closes their own task", async () => {
    const { db, update } = mkDb([
      {
        id: "a1",
        taskType: "BOOKING_PICKUP",
        targetEntityKind: "Booking",
        targetEntityId: "b1",
        staffId: "staff_a",
        status: "IN_PROGRESS",
      },
    ]);
    const n = await autoCloseByTarget(db, "Booking", "b1", {
      types: ["BOOKING_PICKUP"],
      reason: "completed",
      closingUserId: "staff_a",
    });
    expect(n).toBe(1);
    expect(update).toHaveBeenCalledOnce();
    const data = update.mock.calls[0]![0].data;
    expect(data.status).toBe("COMPLETED");
    expect(data.outcome).toBe("closed_by_claimant");
  });

  it("marks SUPERSEDED when a different user closes the task", async () => {
    const { db, update } = mkDb([
      {
        id: "a1",
        taskType: "BOOKING_PICKUP",
        targetEntityKind: "Booking",
        targetEntityId: "b1",
        staffId: "staff_a",
        status: "IN_PROGRESS",
      },
    ]);
    const n = await autoCloseByTarget(db, "Booking", "b1", {
      types: ["BOOKING_PICKUP"],
      reason: "completed",
      closingUserId: "staff_b",
    });
    expect(n).toBe(1);
    const data = update.mock.calls[0]![0].data;
    expect(data.status).toBe("SUPERSEDED");
    expect(data.outcome).toBe("closed_by_other");
  });

  it("marks SUPERSEDED when the target entity goes terminal (cancelled)", async () => {
    const { db, update } = mkDb([
      {
        id: "a1",
        taskType: "BOOKING_PICKUP",
        targetEntityKind: "Booking",
        targetEntityId: "b1",
        staffId: "staff_a",
        status: "IN_PROGRESS",
      },
    ]);
    await autoCloseByTarget(db, "Booking", "b1", {
      reason: "terminal",
      closingUserId: null,
      note: "Cancelled",
    });
    const data = update.mock.calls[0]![0].data;
    expect(data.status).toBe("SUPERSEDED");
    expect(data.outcome).toBe("closed_terminal");
  });

  it("is a no-op when no IN_PROGRESS activity exists", async () => {
    const { db, update } = mkDb([]);
    const n = await autoCloseByTarget(db, "Booking", "b_nope", {
      reason: "completed",
      closingUserId: "staff_a",
    });
    expect(n).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("claimTask", () => {
  it("converts P2002 into a CONFLICT tRPCError", async () => {
    const db = {
      staffTaskActivity: {
        create: async () => {
          throw new Prisma.PrismaClientKnownRequestError("unique violation", {
            code: "P2002",
            clientVersion: "x",
          });
        },
      },
    } as unknown as PrismaLike;
    await expect(
      claimTask(db, {
        taskType: "BOOKING_PICKUP",
        targetEntityKind: "Booking",
        targetEntityId: "b1",
        staffId: "staff_a",
        depotId: null,
        tier: "HIGH",
      }),
    ).rejects.toThrow(TRPCError);
  });
});

describe("manualComplete and abandonTask", () => {
  it("manualComplete: only the claimant can complete", async () => {
    const { db } = mkDb([
      {
        id: "a1",
        taskType: "BOOKING_PICKUP",
        targetEntityKind: "Booking",
        targetEntityId: "b1",
        staffId: "staff_a",
        status: "IN_PROGRESS",
      },
    ]);
    await expect(manualComplete(db, "a1", "staff_b")).rejects.toThrow(TRPCError);
    const res = await manualComplete(db, "a1", "staff_a", "Done");
    expect(res.status).toBe("COMPLETED");
  });

  it("abandonTask: non-owner without force is FORBIDDEN; manager with force succeeds", async () => {
    const { db, update } = mkDb([
      {
        id: "a1",
        taskType: "BOOKING_PICKUP",
        targetEntityKind: "Booking",
        targetEntityId: "b1",
        staffId: "staff_a",
        status: "IN_PROGRESS",
      },
    ]);
    await expect(
      abandonTask(db, "a1", {
        userId: "staff_b",
        userRole: "STAFF",
        reason: "Just because",
        force: false,
      }),
    ).rejects.toThrow(TRPCError);
    await abandonTask(db, "a1", {
      userId: "manager_1",
      userRole: "MANAGER",
      reason: "Staff went home",
      force: true,
    });
    const data = update.mock.calls[0]![0].data;
    expect(data.status).toBe("ABANDONED");
    expect(data.outcome).toBe("abandoned_force");
  });
});
