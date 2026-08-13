import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    bookingSwap: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    maintenanceWorkOrder: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import {
  runSwapDraftCleanup,
  TURNAROUND_WO_TITLE_PREFIX,
} from "../../../src/server/jobs/swap-draft-cleanup";
import { prisma } from "../../../src/lib/prisma";

type MockFn = ReturnType<typeof vi.fn>;
const mockedSwapFindMany = prisma.bookingSwap.findMany as unknown as MockFn;
const mockedSwapUpdate = prisma.bookingSwap.update as unknown as MockFn;
const mockedWoFindMany = prisma.maintenanceWorkOrder.findMany as unknown as MockFn;
const mockedWoUpdate = prisma.maintenanceWorkOrder.update as unknown as MockFn;

beforeEach(() => {
  vi.clearAllMocks();
  mockedSwapFindMany.mockResolvedValue([]);
  mockedSwapUpdate.mockResolvedValue({});
  mockedWoFindMany.mockResolvedValue([]);
  mockedWoUpdate.mockResolvedValue({});
});

describe("swap-draft cleanup job", () => {
  it("voids stale DRAFT swaps", async () => {
    mockedSwapFindMany.mockResolvedValue([
      { id: "sw1", bookingId: "b1", swappedById: "u1", createdAt: new Date(0) },
    ]);

    const res = await runSwapDraftCleanup();

    expect(res).toEqual({ voidedDrafts: 1, completedTurnarounds: 0 });
    expect(mockedSwapUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sw1" },
        data: expect.objectContaining({ status: "VOIDED" }),
      }),
    );
  });

  it("completes expired turnaround work orders only — OPEN + CUSTOM + title prefix + lapsed window", async () => {
    mockedWoFindMany.mockResolvedValue([
      { id: "wo1", notes: null },
      { id: "wo2", notes: "existing note" },
    ]);

    const res = await runSwapDraftCleanup();

    expect(res).toEqual({ voidedDrafts: 0, completedTurnarounds: 2 });
    // The selectivity lives in the WHERE clause: only untouched OPEN CUSTOM
    // turnaround WOs whose scheduled window has already lapsed.
    expect(mockedWoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: "CUSTOM",
          status: "OPEN",
          title: { startsWith: TURNAROUND_WO_TITLE_PREFIX },
          scheduledEndAt: { lt: expect.any(Date) },
        }),
      }),
    );
    expect(mockedWoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wo1" },
        data: expect.objectContaining({
          status: "COMPLETED",
          completedAt: expect.any(Date),
          notes: expect.stringContaining("[AUTO-COMPLETED"),
        }),
      }),
    );
    // Pre-existing notes are preserved, close note appended.
    const wo2Call = mockedWoUpdate.mock.calls.find(
      (c) => (c[0] as { where: { id: string } }).where.id === "wo2",
    );
    expect((wo2Call![0] as { data: { notes: string } }).data.notes).toBe(
      "existing note\n[AUTO-COMPLETED by nightly cleanup: turnaround buffer elapsed]",
    );
  });

  it("is a no-op when nothing matches", async () => {
    const res = await runSwapDraftCleanup();
    expect(res).toEqual({ voidedDrafts: 0, completedTurnarounds: 0 });
    expect(mockedSwapUpdate).not.toHaveBeenCalled();
    expect(mockedWoUpdate).not.toHaveBeenCalled();
  });
});
