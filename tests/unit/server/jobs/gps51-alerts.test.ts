import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FleetAlert } from "@/server/services/gps51-alerts";

const detectFleetAlerts = vi.fn<() => Promise<FleetAlert[]>>();
vi.mock("@/server/services/gps51-alerts", () => ({
  detectFleetAlerts: () => detectFleetAlerts(),
}));

const userFindMany = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const notificationFindFirst = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const notificationCreate = vi.fn<(...a: unknown[]) => Promise<{ id: string }>>(async () => ({ id: "n1" }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    notification: {
      findFirst: (...a: unknown[]) => notificationFindFirst(...a),
      create: (...a: unknown[]) => notificationCreate(...a),
    },
  },
}));
// The scheduler pulls in the queue module; stub it so importing the job is cheap.
vi.mock("@/server/jobs/queue", () => ({
  getQueue: () => null,
  monitorCron: vi.fn(),
  registerWorker: vi.fn(),
}));

import { runFleetAlerts } from "@/server/jobs/gps51-alerts";

const offline: FleetAlert = {
  type: "TRACKER_OFFLINE",
  vehicleId: "v1",
  deviceId: "d1",
  depotId: "depot1",
  label: "XM-01",
  detail: "No GPS fix for 2h.",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Staff at depot1 + a depot-less admin both qualify; other-depot staff don't.
  userFindMany.mockResolvedValue([
    { id: "u-depot1", depotId: "depot1" },
    { id: "u-global", depotId: null },
    { id: "u-other", depotId: "depot2" },
  ]);
});

describe("runFleetAlerts", () => {
  it("creates one notification per depot-matched recipient for a new alert", async () => {
    detectFleetAlerts.mockResolvedValue([offline]);
    notificationFindFirst.mockResolvedValue(null); // not yet alerted today

    const created = await runFleetAlerts();

    expect(created).toBe(2); // depot1 staff + global admin; not the depot2 user
    const recipients = notificationCreate.mock.calls.map(
      (c) => (c[0] as { data: { userId: string } }).data.userId,
    );
    expect(recipients.sort()).toEqual(["u-depot1", "u-global"]);
    expect((notificationCreate.mock.calls[0]![0] as { data: { type: string } }).data.type).toBe(
      "TRACKER_OFFLINE",
    );
  });

  it("dedups when an alert for the same vehicle/type/day already exists", async () => {
    detectFleetAlerts.mockResolvedValue([offline]);
    notificationFindFirst.mockResolvedValue({ id: "existing" });

    const created = await runFleetAlerts();

    expect(created).toBe(0);
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("no-ops when there are no alerts", async () => {
    detectFleetAlerts.mockResolvedValue([]);
    expect(await runFleetAlerts()).toBe(0);
    expect(userFindMany).not.toHaveBeenCalled();
  });
});
