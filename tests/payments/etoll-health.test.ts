import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G21 — E-Toll health monitor.
 *
 *   - Healthy when a recent etoll-sync success audit row exists.
 *   - Alerts when none in the window AND no recent cooldown alert.
 *   - Within cooldown → does not alert twice.
 */

const auditFindFirst = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});
const userFindMany = vi.fn();
const sendNotification = vi.fn().mockResolvedValue({ results: [], logIds: [], notificationIds: [] });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findFirst: auditFindFirst, create: auditCreate },
    user: { findMany: userFindMany },
  },
}));

vi.mock("@/server/services/notification-sender", () => ({ sendNotification }));

vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn().mockReturnValue(null),
  registerWorker: vi.fn(),
}));

beforeEach(() => {
  auditFindFirst.mockReset();
  auditCreate.mockClear();
  userFindMany.mockReset();
  userFindMany.mockResolvedValue([{ id: "mgr_1" }]);
  sendNotification.mockClear();
});

describe("etoll-health", () => {
  it("returns OK when a recent sync success is found", async () => {
    auditFindFirst.mockResolvedValueOnce({
      timestamp: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
      action: "etoll-sync.complete",
    });
    const { runEtollHealth } = await import("@/server/jobs/etoll-health");
    const r = await runEtollHealth();
    expect(r.ok).toBe(true);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("alerts managers when no recent sync and no cooldown", async () => {
    auditFindFirst
      .mockResolvedValueOnce(null) // no recent success
      .mockResolvedValueOnce(null); // no recent alert (cooldown miss)
    const { runEtollHealth } = await import("@/server/jobs/etoll-health");
    const r = await runEtollHealth();
    expect(r.ok).toBe(false);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "mgr_1", type: "INCIDENT_REPORTED" }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "etoll-health.alert_sent" }),
      }),
    );
  });

  it("does not alert twice within the cooldown window", async () => {
    auditFindFirst
      .mockResolvedValueOnce(null) // no recent success
      .mockResolvedValueOnce({ id: "prior_alert" }); // cooldown hit
    const { runEtollHealth } = await import("@/server/jobs/etoll-health");
    const r = await runEtollHealth();
    expect(r.ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
