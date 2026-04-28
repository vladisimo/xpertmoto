import { Prisma, type StaffTaskType, type StaffTaskTier } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { PrismaLike } from "@/server/services/staff-ops-signals";
import type { TargetEntityKind } from "@/lib/tasks/types";

export type CloseReason = "completed" | "cancelled" | "terminal" | "manual" | "force";

interface CloseOptions {
  types?: StaffTaskType[];
  reason: CloseReason;
  closingUserId: string | null;
  note?: string;
}

/**
 * Close any IN_PROGRESS activities targeting this entity.
 * If the closing user matches the claimant AND the reason is "completed",
 * mark COMPLETED. Otherwise mark SUPERSEDED so admin metrics can distinguish
 * the healthy finish from the "someone else finished this" case.
 *
 * MUST be called inside the same Prisma transaction as the domain mutation
 * so a rollback on the mutation leaves the task open.
 */
export async function autoCloseByTarget(
  tx: PrismaLike,
  kind: TargetEntityKind,
  id: string,
  opts: CloseOptions,
): Promise<number> {
  const open = await tx.staffTaskActivity.findMany({
    where: {
      targetEntityKind: kind,
      targetEntityId: id,
      status: "IN_PROGRESS",
      ...(opts.types && opts.types.length > 0 ? { taskType: { in: opts.types } } : {}),
    },
    select: { id: true, staffId: true, taskType: true },
  });
  if (open.length === 0) return 0;
  const now = new Date();
  let closed = 0;
  for (const activity of open) {
    const claimantClosed =
      opts.reason === "completed" &&
      opts.closingUserId !== null &&
      opts.closingUserId === activity.staffId;
    const status: "COMPLETED" | "SUPERSEDED" = claimantClosed ? "COMPLETED" : "SUPERSEDED";
    const outcome = claimantClosed
      ? "closed_by_claimant"
      : opts.reason === "terminal" || opts.reason === "cancelled"
        ? `closed_${opts.reason}`
        : "closed_by_other";
    await tx.staffTaskActivity.update({
      where: { id: activity.id },
      data: {
        status,
        completedAt: now,
        outcome,
        outcomeNote: opts.note ?? null,
      },
    });
    closed += 1;
  }
  return closed;
}

/**
 * Close every IN_PROGRESS activity for an entity that has gone terminal
 * (booking cancelled, vehicle written off, etc.). Shorthand for
 * `autoCloseByTarget(..., { reason: "terminal" })`.
 */
export async function supersedeByTarget(
  tx: PrismaLike,
  kind: TargetEntityKind,
  id: string,
  note?: string,
): Promise<number> {
  return autoCloseByTarget(tx, kind, id, {
    reason: "terminal",
    closingUserId: null,
    note,
  });
}

export interface ClaimTaskInput {
  taskType: StaffTaskType;
  targetEntityKind: TargetEntityKind;
  targetEntityId: string;
  staffId: string;
  depotId: string | null;
  tier: StaffTaskTier;
  metadata?: Prisma.InputJsonValue;
  /** Collector-reported time the task first became actionable. Captured so
   *  the history view can compute queue-wait and end-to-end cycle times. */
  actionableSince?: Date | null;
}

/**
 * Claim a virtual task — insert an IN_PROGRESS activity row. Races are
 * resolved by the partial unique index; the loser receives a tRPC CONFLICT.
 */
export async function claimTask(tx: PrismaLike, input: ClaimTaskInput) {
  try {
    return await tx.staffTaskActivity.create({
      data: {
        taskType: input.taskType,
        targetEntityKind: input.targetEntityKind,
        targetEntityId: input.targetEntityId,
        staffId: input.staffId,
        depotId: input.depotId,
        tierSnapshot: input.tier,
        status: "IN_PROGRESS",
        metadata: input.metadata,
        lastHeartbeatAt: new Date(),
        actionableSinceSnapshot: input.actionableSince ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This task has already been claimed by another staff member.",
      });
    }
    throw err;
  }
}

/**
 * Update the heartbeat on an IN_PROGRESS activity. Only the claimant may
 * heartbeat their own activity.
 */
export async function heartbeat(tx: PrismaLike, activityId: string, userId: string) {
  const res = await tx.staffTaskActivity.updateMany({
    where: { id: activityId, staffId: userId, status: "IN_PROGRESS" },
    data: { lastHeartbeatAt: new Date() },
  });
  return res.count > 0;
}

export async function manualComplete(
  tx: PrismaLike,
  activityId: string,
  userId: string,
  note?: string,
) {
  const activity = await tx.staffTaskActivity.findUnique({ where: { id: activityId } });
  if (!activity) throw new TRPCError({ code: "NOT_FOUND" });
  if (activity.status !== "IN_PROGRESS")
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Task is no longer in progress." });
  if (activity.staffId !== userId)
    throw new TRPCError({ code: "FORBIDDEN", message: "This task is not claimed by you." });
  return tx.staffTaskActivity.update({
    where: { id: activityId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      outcome: "manual_complete",
      outcomeNote: note ?? null,
    },
  });
}

export async function abandonTask(
  tx: PrismaLike,
  activityId: string,
  opts: { userId: string; userRole: string; reason: string; force: boolean },
) {
  const activity = await tx.staffTaskActivity.findUnique({ where: { id: activityId } });
  if (!activity) throw new TRPCError({ code: "NOT_FOUND" });
  if (activity.status !== "IN_PROGRESS")
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Task is no longer in progress." });
  const isOwner = activity.staffId === opts.userId;
  const canForce =
    opts.force &&
    ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(opts.userRole) &&
    !isOwner;
  if (!isOwner && !canForce) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only abandon your own task unless you are a manager using force.",
    });
  }
  return tx.staffTaskActivity.update({
    where: { id: activityId },
    data: {
      status: "ABANDONED",
      completedAt: new Date(),
      outcome: isOwner ? "abandoned_by_claimant" : "abandoned_force",
      outcomeNote: opts.reason,
    },
  });
}
