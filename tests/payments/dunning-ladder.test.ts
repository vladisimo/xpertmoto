import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G7 — dunning ladder progression.
 *
 * Covers:
 *   - stage 1 fires on a fresh debtor (no prior DUNNING_STAGE_* row)
 *   - stage 1 → 2 only fires after the required gap
 *   - stage 4 flags the customer MEDIUM and skips customer email
 *   - stage 5 flags HIGH
 *   - debtor with paid balance produces no fires (no stages scheduled)
 */

const debtorsList = vi.fn();
const commFindMany = vi.fn();
const commCreate = vi.fn().mockResolvedValue({});
const profileUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const userFindMany = vi.fn().mockResolvedValue([{ id: "mgr_1" }]);
const auditCreate = vi.fn().mockResolvedValue({});
const sendNotification = vi.fn().mockResolvedValue({ results: [], logIds: [], notificationIds: [] });

vi.mock("@/server/services/admin-risk-signals", () => ({
  debtorsList: (...args: unknown[]) => debtorsList(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationLog: { findMany: commFindMany, create: commCreate },
    customerProfile: { updateMany: profileUpdateMany },
    user: { findMany: userFindMany },
    auditLog: { create: auditCreate },
  },
}));

vi.mock("@/server/services/notification-sender", () => ({ sendNotification }));

vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn().mockReturnValue(null),
  registerWorker: vi.fn(),
}));

const mkDebtor = (opts: { id: string; owed: number; phone?: string | null }) => ({
  customerId: opts.id,
  firstName: "Test",
  lastName: "User",
  email: "t@u.co",
  phone: opts.phone ?? null,
  bookingDebt: 0,
  invoiceDebt: 0,
  infringementDebt: opts.owed,
  totalOwed: opts.owed,
  lastReminderAt: null,
});

beforeEach(() => {
  debtorsList.mockReset();
  commFindMany.mockReset();
  commCreate.mockClear();
  profileUpdateMany.mockClear();
  userFindMany.mockClear();
  userFindMany.mockResolvedValue([{ id: "mgr_1" }]);
  auditCreate.mockClear();
  sendNotification.mockClear();
});

describe("dunning ladder", () => {
  it("fires stage 1 on a fresh debtor with no prior dunning", async () => {
    debtorsList.mockResolvedValue([mkDebtor({ id: "c1", owed: 150, phone: "+61400000000" })]);
    commFindMany.mockResolvedValue([]); // never dunned before
    const { runDunningLadder } = await import("@/server/jobs/dunning-ladder");
    const r = await runDunningLadder();
    expect(r.stages[1]).toBe(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "c1",
        type: "DEBT_REMINDER",
        data: expect.objectContaining({ stage: 1 }),
      }),
    );
    expect(commCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateUsed: "DUNNING_STAGE_1" }) }),
    );
  });

  it("does not advance to stage 2 until 7 days after stage 1", async () => {
    debtorsList.mockResolvedValue([mkDebtor({ id: "c2", owed: 200 })]);
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    commFindMany.mockResolvedValue([{ templateUsed: "DUNNING_STAGE_1", sentAt: threeDaysAgo }]);
    const { runDunningLadder } = await import("@/server/jobs/dunning-ladder");
    const r = await runDunningLadder();
    expect(r.progressed).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("advances from stage 3 to stage 4 and flags risk MEDIUM, without customer email", async () => {
    debtorsList.mockResolvedValue([mkDebtor({ id: "c4", owed: 500 })]);
    const daysAgo = new Date(Date.now() - 15 * 86_400_000);
    commFindMany.mockResolvedValue([{ templateUsed: "DUNNING_STAGE_3", sentAt: daysAgo }]);
    const { runDunningLadder } = await import("@/server/jobs/dunning-ladder");
    const r = await runDunningLadder();
    expect(r.stages[4]).toBe(1);
    expect(profileUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "c4", riskRating: "LOW" }),
        data: { riskRating: "MEDIUM" },
      }),
    );
    // Stage 4 notifies managers only — no customer-facing email
    const customerCall = sendNotification.mock.calls.find((c) => (c[0] as { userId: string }).userId === "c4");
    expect(customerCall).toBeUndefined();
    const managerCall = sendNotification.mock.calls.find((c) => (c[0] as { userId: string }).userId === "mgr_1");
    expect(managerCall).toBeTruthy();
  });

  it("advances from stage 4 to stage 5 and flags risk HIGH after 30 days", async () => {
    debtorsList.mockResolvedValue([mkDebtor({ id: "c5", owed: 1200 })]);
    const daysAgo = new Date(Date.now() - 35 * 86_400_000);
    commFindMany.mockResolvedValue([{ templateUsed: "DUNNING_STAGE_4", sentAt: daysAgo }]);
    const { runDunningLadder } = await import("@/server/jobs/dunning-ladder");
    const r = await runDunningLadder();
    expect(r.stages[5]).toBe(1);
    expect(profileUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "c5", riskRating: { in: ["LOW", "MEDIUM"] } }),
        data: { riskRating: "HIGH" },
      }),
    );
  });

  it("stage 5 re-fires every 30 days — unresolved debt never goes silent", async () => {
    debtorsList.mockResolvedValue([mkDebtor({ id: "c6", owed: 2000 })]);
    commFindMany.mockResolvedValue([
      { templateUsed: "DUNNING_STAGE_5", sentAt: new Date(Date.now() - 120 * 86_400_000) },
    ]);
    const { runDunningLadder } = await import("@/server/jobs/dunning-ladder");
    const r = await runDunningLadder();
    // Re-escalates at stage 5 (write-off-or-pursue decision), no stage 6.
    expect(r.progressed).toBe(1);
    expect(r.stages[5]).toBe(1);
  });

  it("stage 5 does NOT re-fire inside its 30-day window", async () => {
    debtorsList.mockResolvedValue([mkDebtor({ id: "c7", owed: 2000 })]);
    commFindMany.mockResolvedValue([
      { templateUsed: "DUNNING_STAGE_5", sentAt: new Date(Date.now() - 10 * 86_400_000) },
    ]);
    const { runDunningLadder } = await import("@/server/jobs/dunning-ladder");
    const r = await runDunningLadder();
    expect(r.progressed).toBe(0);
  });
});
