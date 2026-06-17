import { beforeEach, describe, expect, it, vi } from "vitest";

const infringementFindMany = vi.fn();
const infringementUpdate = vi.fn();
const userFindMany = vi.fn();
const notificationFindFirst = vi.fn();
const notificationCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    infringement: {
      findMany: (...a: unknown[]) => infringementFindMany(...a),
      update: (...a: unknown[]) => infringementUpdate(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    notification: {
      findFirst: (...a: unknown[]) => notificationFindFirst(...a),
      create: (...a: unknown[]) => notificationCreate(...a),
    },
  },
}));

// The job module imports ./queue (bullmq/ioredis); no Redis in tests → no-op.
import { runNominationDeadlineCheck } from "@/server/jobs/nomination-deadline";

const NOW = new Date("2026-06-15T03:00:00Z");

function infMatchingSoon(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inf1",
    type: "SPEEDING",
    referenceNumber: "PN-1",
    nominationDeadline: new Date("2026-06-17T00:00:00Z"), // 2 days out
    deadlineEscalatedAt: null,
    vehicle: { internalCode: "S-01", rego: "ABC123", depotId: "d1" },
    booking: { bookingReference: "BK-1" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindMany.mockResolvedValue([{ id: "mgr1", depotId: null }]);
  notificationFindFirst.mockResolvedValue(null);
  notificationCreate.mockResolvedValue({});
  infringementUpdate.mockResolvedValue({});
});

describe("runNominationDeadlineCheck", () => {
  it("escalates a not-yet-alerted infringement and stamps the latch", async () => {
    infringementFindMany.mockResolvedValue([infMatchingSoon()]);
    const res = await runNominationDeadlineCheck(NOW);
    expect(res).toEqual({ checked: 1, escalated: 1 });
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "INFRINGEMENT_DEADLINE",
          userId: "mgr1",
          data: expect.objectContaining({ tier: "t2" }),
        }),
      }),
    );
    expect(infringementUpdate).toHaveBeenCalledWith({
      where: { id: "inf1" },
      data: { deadlineEscalatedAt: NOW },
    });
  });

  it("skips an infringement already escalated today", async () => {
    infringementFindMany.mockResolvedValue([
      infMatchingSoon({ deadlineEscalatedAt: new Date("2026-06-15T01:00:00Z") }),
    ]);
    const res = await runNominationDeadlineCheck(NOW);
    expect(res).toEqual({ checked: 1, escalated: 0 });
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("does not re-create a notification for the same tier (idempotent), only refreshes the latch", async () => {
    infringementFindMany.mockResolvedValue([infMatchingSoon()]);
    notificationFindFirst.mockResolvedValue({ id: "n-existing" });
    const res = await runNominationDeadlineCheck(NOW);
    expect(res).toEqual({ checked: 1, escalated: 0 });
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(infringementUpdate).toHaveBeenCalledWith({
      where: { id: "inf1" },
      data: { deadlineEscalatedAt: NOW },
    });
  });

  it("marks overdue items with the overdue tier", async () => {
    infringementFindMany.mockResolvedValue([
      infMatchingSoon({ nominationDeadline: new Date("2026-06-13T00:00:00Z") }),
    ]);
    await runNominationDeadlineCheck(NOW);
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ data: expect.objectContaining({ tier: "overdue" }) }),
      }),
    );
  });
});
