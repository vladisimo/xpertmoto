import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const telemetryCreate = vi.fn().mockResolvedValue({});
const vehicleFindFirst = vi.fn();
const vehicleUpdate = vi.fn().mockResolvedValue({});
const systemSettingFindUnique = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    vehicleTelemetry: { create: telemetryCreate },
    vehicle: { findFirst: vehicleFindFirst, update: vehicleUpdate },
    systemSetting: { findUnique: systemSettingFindUnique },
  },
}));

vi.mock("@/lib/integration-config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integration-config")>("@/lib/integration-config");
  return { ...actual, invalidateAll: actual.invalidateAll };
});

const TOKEN = "test-telemetry-token-abc";
const ORIGINAL = process.env.TELEMETRY_INGEST_TOKEN;

async function post(body: unknown, token = TOKEN) {
  const { POST } = await import("@/app/api/webhooks/telemetry/route");
  return POST(
    new Request("http://localhost/api/webhooks/telemetry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  telemetryCreate.mockClear();
  vehicleFindFirst.mockReset();
  vehicleUpdate.mockClear();
  systemSettingFindUnique.mockResolvedValue(null);
  process.env.TELEMETRY_INGEST_TOKEN = TOKEN;
  const { invalidateAll } = await import("@/lib/integration-config");
  invalidateAll();
});
afterEach(() => {
  process.env.TELEMETRY_INGEST_TOKEN = ORIGINAL;
});

describe("Telemetry webhook", () => {
  it("returns 503 when ingest not configured", async () => {
    delete process.env.TELEMETRY_INGEST_TOKEN;
    const res = await post({ deviceId: "d1", timestamp: new Date(), latitude: 0, longitude: 0 });
    expect(res.status).toBe(503);
  });

  it("rejects bad bearer token with 401", async () => {
    const res = await post({ deviceId: "d1", timestamp: new Date(), latitude: 0, longitude: 0 }, "wrong");
    expect(res.status).toBe(401);
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await post("not-json");
    expect(res.status).toBe(400);
  });

  it("validates schema and rejects bad coordinates with 400", async () => {
    const res = await post({ deviceId: "d1", timestamp: "2026-05-01T00:00:00Z", latitude: 999, longitude: 0 });
    expect(res.status).toBe(400);
  });

  it("persists a single ping and updates vehicle odometer when matched", async () => {
    vehicleFindFirst.mockResolvedValue({ id: "veh_1", currentOdometerKm: 1000 });
    const res = await post({
      deviceId: "dev_1",
      timestamp: "2026-05-01T00:00:00Z",
      latitude: -28.5,
      longitude: 153.5,
      odometerKm: 1050,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ received: 1, persisted: 1, matched: 1 });
    expect(telemetryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vehicleId: "veh_1", deviceId: "dev_1", latitude: -28.5 }),
      }),
    );
    expect(vehicleUpdate).toHaveBeenCalledWith({
      where: { id: "veh_1" },
      data: { currentOdometerKm: 1050 },
    });
  });

  it("ignores odometer updates when delta is unrealistic", async () => {
    vehicleFindFirst.mockResolvedValue({ id: "veh_1", currentOdometerKm: 1000 });
    await post({
      deviceId: "dev_1",
      timestamp: "2026-05-01T00:00:00Z",
      latitude: 0,
      longitude: 0,
      odometerKm: 99999,
    });
    expect(vehicleUpdate).not.toHaveBeenCalled();
  });

  it("accepts a batch of pings", async () => {
    vehicleFindFirst.mockResolvedValue(null);
    const res = await post([
      { deviceId: "d1", timestamp: "2026-05-01T00:00:00Z", latitude: -28, longitude: 153 },
      { deviceId: "d1", timestamp: "2026-05-01T00:05:00Z", latitude: -28.01, longitude: 153.01 },
    ]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(2);
    expect(telemetryCreate).toHaveBeenCalledTimes(2);
  });
});
