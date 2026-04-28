import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: {
      findUnique: vi.fn(),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

function stubSettings(overrides: Record<string, unknown> = {}) {
  const rows = Object.entries(overrides).map(([key, value]) => ({ key, value }));
  findMany.mockResolvedValue(rows);
}

beforeEach(() => {
  findMany.mockReset();
});

describe("evaluateNotificationGate", () => {
  it("allows EMAIL when nothing is paused and channel enabled", async () => {
    stubSettings();
    const { evaluateNotificationGate } = await import(
      "@/server/services/notification-gate"
    );
    await expect(evaluateNotificationGate("EMAIL")).resolves.toEqual({ send: true });
  });

  it("blocks every channel when pauseAll=true", async () => {
    stubSettings({ "notification.pauseAll": true });
    const { evaluateNotificationGate } = await import(
      "@/server/services/notification-gate"
    );
    for (const channel of ["EMAIL", "SMS", "PUSH", "IN_APP"] as const) {
      await expect(evaluateNotificationGate(channel)).resolves.toEqual({
        send: false,
        reason: "paused",
      });
    }
  });

  it("blocks only EMAIL when enableEmail=false and others stay enabled", async () => {
    stubSettings({ "notification.enableEmail": false });
    const { evaluateNotificationGate } = await import(
      "@/server/services/notification-gate"
    );
    await expect(evaluateNotificationGate("EMAIL")).resolves.toEqual({
      send: false,
      reason: "channel_disabled",
    });
    await expect(evaluateNotificationGate("SMS")).resolves.toEqual({ send: true });
    await expect(evaluateNotificationGate("PUSH")).resolves.toEqual({ send: true });
    await expect(evaluateNotificationGate("IN_APP")).resolves.toEqual({ send: true });
  });

  it("prefers 'paused' reason when pauseAll wins over a disabled channel", async () => {
    stubSettings({
      "notification.pauseAll": true,
      "notification.enableEmail": false,
    });
    const { evaluateNotificationGate } = await import(
      "@/server/services/notification-gate"
    );
    await expect(evaluateNotificationGate("EMAIL")).resolves.toEqual({
      send: false,
      reason: "paused",
    });
  });

  it("falls back to defaults (send=true) when the DB read throws", async () => {
    findMany.mockRejectedValue(new Error("db down"));
    const { evaluateNotificationGate } = await import(
      "@/server/services/notification-gate"
    );
    await expect(evaluateNotificationGate("EMAIL")).resolves.toEqual({ send: true });
  });
});

describe("isNotificationsPaused", () => {
  it("returns true when pauseAll=true", async () => {
    stubSettings({ "notification.pauseAll": true });
    const { isNotificationsPaused } = await import(
      "@/server/services/notification-gate"
    );
    await expect(isNotificationsPaused()).resolves.toBe(true);
  });

  it("returns false when no rows present (default path)", async () => {
    stubSettings();
    const { isNotificationsPaused } = await import(
      "@/server/services/notification-gate"
    );
    await expect(isNotificationsPaused()).resolves.toBe(false);
  });
});
