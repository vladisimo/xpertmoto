import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fleetRouter,
  tollPointFromNotes,
  segmentTrack,
} from "../../../../src/server/trpc/router/fleet";
import { queryTracks, runGps51DailyTrackSync } from "../../../../src/server/services/gps51";

// Keep the real helpers (num/deriveIgnition/parseStatusVoltage/Gps51RateLimitError)
// but stub the network-bound querytracks call and the daily full-track sync.
vi.mock("../../../../src/server/services/gps51", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/server/services/gps51")>();
  return { ...actual, queryTracks: vi.fn(), runGps51DailyTrackSync: vi.fn() };
});

// Force the no-Redis path so gps51DailySyncNow runs inline deterministically
// (getQueue is used only by that procedure in this router).
vi.mock("../../../../src/server/jobs/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/server/jobs/queue")>();
  return { ...actual, getQueue: vi.fn(() => null) };
});

// The liveLocations Redis cache must never serve a hit here: a live dev Redis
// (or a prior test's write) would swallow the prisma query the specs assert on.
vi.mock("../../../../src/server/services/gps51-live-cache", () => ({
  readLiveLocationsCache: vi.fn(async () => null),
  writeLiveLocationsCache: vi.fn(async () => undefined),
}));

// chargeCustomerForIncident: stub the Stripe bond capture, the (dynamically
// imported) adjustment-note pipeline and analytics so the ledger specs stay
// pure unit tests — MSW errors on any real network call.
const capturePaymentIntentMock = vi.fn();
vi.mock("@/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/lib/stripe")>();
  return {
    ...actual,
    capturePaymentIntent: (...args: unknown[]) => capturePaymentIntentMock(...args),
  };
});
const tryIssueAdjustmentForBookingMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/invoice-lifecycle", () => ({
  tryIssueAdjustmentForBooking: (...args: unknown[]) =>
    tryIssueAdjustmentForBookingMock(...args),
}));
vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/lib/analytics")>();
  return { ...actual, trackServer: vi.fn(async () => undefined) };
});

type Caller = ReturnType<typeof fleetRouter.createCaller>;

function makeCtx(over: { role?: "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN"; existingCount?: number } = {}) {
  const create = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "img1", ...data }),
  );
  const prisma = {
    vehicle: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "veh1" }) },
    vehicleImage: {
      count: vi.fn().mockResolvedValue(over.existingCount ?? 0),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create,
    },
  };
  const role = over.role ?? "STAFF";
  const ctx = {
    prisma,
    user: { id: "staff1", role },
    session: { user: { id: "staff1", role } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  } as unknown as Parameters<Caller["addVehicleImage"]>[0];
  return { ctx, prisma, create };
}

beforeEach(() => vi.clearAllMocks());

describe("fleet.addVehicleImage", () => {
  it("persists the content checksum so the model page can dedupe by it", async () => {
    const { ctx, create } = makeCtx();
    const caller = fleetRouter.createCaller(ctx as never);

    await caller.addVehicleImage({
      vehicleId: "veh1",
      url: "/uploads/vehicles/MTB-1/abc.png",
      checksum: "sha-deadbeef",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vehicleId: "veh1",
          url: "/uploads/vehicles/MTB-1/abc.png",
          checksum: "sha-deadbeef",
          isPrimary: true, // first image
          displayOrder: 0,
        }),
      }),
    );
  });

  it("accepts an image without a checksum (optional input)", async () => {
    const { ctx, create } = makeCtx();
    const caller = fleetRouter.createCaller(ctx as never);

    await caller.addVehicleImage({ vehicleId: "veh1", url: "/uploads/vehicles/MTB-1/abc.png" });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ checksum: undefined }) }),
    );
  });

  it("rejects an anonymous caller (staffProcedure)", async () => {
    const ctx = {
      prisma: {},
      user: null,
      session: null,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["addVehicleImage"]>[0];
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(
      caller.addVehicleImage({ vehicleId: "veh1", url: "/uploads/x.png" }),
    ).rejects.toThrow();
  });
});

describe("fleet.vehicleTolls", () => {
  function makeTollsCtx(
    over: {
      role?: "STAFF" | "MANAGER";
      tolls?: Array<Record<string, unknown>>;
      customers?: Array<Record<string, unknown>>;
      payments?: Array<Record<string, unknown>>;
    } = {},
  ) {
    const infringementFindMany = vi.fn().mockResolvedValue(over.tolls ?? []);
    const userFindMany = vi.fn().mockResolvedValue(over.customers ?? []);
    const paymentFindMany = vi.fn().mockResolvedValue(over.payments ?? []);
    const prisma = {
      infringement: { findMany: infringementFindMany },
      user: { findMany: userFindMany },
      payment: { findMany: paymentFindMany },
    };
    const role = over.role ?? "STAFF";
    const ctx = {
      prisma,
      user: { id: "staff1", role },
      session: { user: { id: "staff1", role } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["vehicleTolls"]>[0];
    return { ctx, infringementFindMany, userFindMany, paymentFindMany };
  }

  it("queries only TOLL infringements scoped to the vehicle", async () => {
    const { ctx, infringementFindMany } = makeTollsCtx();
    const caller = fleetRouter.createCaller(ctx as never);

    const result = await caller.vehicleTolls({ vehicleId: "veh1" });

    expect(result).toEqual([]);
    const args = infringementFindMany.mock.calls[0]?.[0] as {
      where?: { type?: string; vehicleId?: string; deletedAt?: null };
    };
    expect(args?.where).toMatchObject({
      type: "TOLL",
      vehicleId: "veh1",
      deletedAt: null,
    });
  });

  it("joins the recovery payment and resolves the booking-matched customer", async () => {
    const { ctx } = makeTollsCtx({
      tolls: [
        {
          id: "inf1",
          referenceNumber: "TOLL-123",
          issuer: "Linkt-NSW (Fleet)",
          offenceDate: new Date("2026-06-01"),
          amount: { toString: () => "12.34" },
          adminFee: { toString: () => "5.00" },
          status: "CUSTOMER_CHARGED",
          offenceLocation: null,
          notes: "Toll: M5 East Tunnel. Source: PLATE | 12.34 | M5",
          customerId: null,
          booking: { id: "bk1", bookingReference: "BK-1", customerId: "cust1" },
        },
      ],
      customers: [{ id: "cust1", firstName: "Ada", lastName: "Lovelace" }],
      payments: [
        {
          id: "pay1",
          reference: "INFR-TOLL-123",
          status: "SUCCEEDED",
          amount: { toString: () => "17.34" },
          createdAt: new Date("2026-06-02"),
          processedAt: new Date("2026-06-02"),
        },
      ],
    });
    const caller = fleetRouter.createCaller(ctx as never);

    const result = await caller.vehicleTolls({ vehicleId: "veh1" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "inf1",
      referenceNumber: "TOLL-123",
      location: "M5 East Tunnel",
      amount: 12.34,
      booking: { id: "bk1", bookingReference: "BK-1" },
      customer: { id: "cust1", name: "Ada Lovelace" },
      payment: { id: "pay1", status: "SUCCEEDED", amount: 17.34 },
    });
  });

  it("rejects an anonymous caller (staffProcedure)", async () => {
    const ctx = {
      prisma: {},
      user: null,
      session: null,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["vehicleTolls"]>[0];
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(caller.vehicleTolls({ vehicleId: "veh1" })).rejects.toThrow();
  });
});

describe("fleet.vehicleTrack", () => {
  function makeTrackCtx(
    over: {
      role?: "STAFF" | "MANAGER";
      telemetry?: Array<Record<string, unknown>>;
      bookings?: Array<Record<string, unknown>>;
    } = {},
  ) {
    const telemetryFindMany = vi.fn().mockResolvedValue(over.telemetry ?? []);
    const bookingFindMany = vi.fn().mockResolvedValue(over.bookings ?? []);
    const vehicleFindUnique = vi
      .fn()
      .mockResolvedValue({ gpsTrackerId: (over as { trackerId?: string | null }).trackerId ?? null });
    const prisma = {
      vehicleTelemetry: { findMany: telemetryFindMany },
      booking: { findMany: bookingFindMany },
      vehicle: { findUnique: vehicleFindUnique },
    };
    const role = over.role ?? "STAFF";
    const ctx = {
      prisma,
      user: { id: "staff1", role },
      session: { user: { id: "staff1", role } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["vehicleTrack"]>[0];
    return { ctx, telemetryFindMany, bookingFindMany };
  }

  const from = new Date("2026-06-01T00:00:00Z");
  const to = new Date("2026-06-02T00:00:00Z");

  it("returns points, summary, trips and booking tags for a window", async () => {
    const { ctx } = makeTrackCtx({
      telemetry: [
        { timestamp: new Date("2026-06-01T09:00:00Z"), latitude: -27.5, longitude: 153.0, speedKph: 0, headingDeg: 90, ignitionOn: true, batteryPct: 80 },
        { timestamp: new Date("2026-06-01T09:01:00Z"), latitude: -27.51, longitude: 153.01, speedKph: 40, headingDeg: 95, ignitionOn: true, batteryPct: 79 },
      ],
      bookings: [
        {
          id: "bk1",
          bookingReference: "BK-1",
          pickupDateTime: new Date("2026-06-01T08:00:00Z"),
          returnDateTime: new Date("2026-06-01T18:00:00Z"),
          actualPickupDateTime: null,
          actualReturnDateTime: null,
        },
      ],
    });
    const caller = fleetRouter.createCaller(ctx as never);

    const result = await caller.vehicleTrack({ vehicleId: "veh1", from, to });

    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toMatchObject({ bookingId: "bk1", bookingReference: "BK-1" });
    expect(result.summary?.pointCount).toBe(2);
    expect(result.trips).toHaveLength(1);
    expect(result.parkings).toEqual([]);
    expect(result.bookings).toEqual([{ id: "bk1", bookingReference: "BK-1" }]);
    expect(result.truncated).toBe(false);
  });

  it("labels the window as gps51 + surfaces rich telemetry from cached track pulls", async () => {
    const { ctx } = makeTrackCtx({
      telemetry: [
        {
          timestamp: new Date("2026-06-01T09:00:00Z"),
          latitude: -27.5,
          longitude: 153.0,
          speedKph: 40,
          headingDeg: 90,
          ignitionOn: true,
          batteryPct: 80,
          odometerKm: 1.5,
          source: "gps51-track",
          raw: { moving: 1, strstatusen: "ACC On Voltage 12.6V" },
        },
      ],
    });
    const caller = fleetRouter.createCaller(ctx as never);

    const result = await caller.vehicleTrack({ vehicleId: "veh1", from, to });

    expect(result.source).toBe("gps51");
    expect(result.points[0]).toMatchObject({ moving: true, statusText: "ACC On Voltage 12.6V", voltage: 12.6 });
  });

  it("filters displayed fixes by minSpeedKph in memory, not via the SQL query", async () => {
    const { ctx, telemetryFindMany } = makeTrackCtx({
      telemetry: [
        { timestamp: new Date("2026-06-01T09:00:00Z"), latitude: -27.5, longitude: 153.0, speedKph: 10, headingDeg: null, ignitionOn: true, batteryPct: null },
        { timestamp: new Date("2026-06-01T09:01:00Z"), latitude: -27.51, longitude: 153.01, speedKph: 40, headingDeg: null, ignitionOn: true, batteryPct: null },
      ],
    });
    const caller = fleetRouter.createCaller(ctx as never);

    const result = await caller.vehicleTrack({ vehicleId: "veh1", from, to, onlyMoving: true, minSpeedKph: 30 });

    // The window query is NOT speed-narrowed — segmentation needs the slow/stationary fixes.
    const args = telemetryFindMany.mock.calls[0]?.[0] as { where?: { speedKph?: unknown } };
    expect(args?.where?.speedKph).toBeUndefined();
    // The displayed fixes are thinned to ≥30 km/h, but the summary still sees both.
    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.speedKph).toBe(40);
    expect(result.summary?.pointCount).toBe(2);
  });

  it("nulls implausible glitch speeds so they can't poison max-speed or the table", async () => {
    const { ctx } = makeTrackCtx({
      telemetry: [
        { timestamp: new Date("2026-06-01T09:00:00Z"), latitude: -27.5, longitude: 153.0, speedKph: 45, headingDeg: 90, ignitionOn: true, batteryPct: 80 },
        // A mis-parsed GPS fix reporting 70,300 km/h — must be treated as unknown.
        { timestamp: new Date("2026-06-01T09:01:00Z"), latitude: -27.51, longitude: 153.01, speedKph: 70300, headingDeg: 95, ignitionOn: true, batteryPct: 79 },
      ],
    });
    const caller = fleetRouter.createCaller(ctx as never);

    const result = await caller.vehicleTrack({ vehicleId: "veh1", from, to });

    expect(result.points).toHaveLength(2);
    expect(result.points[1]?.speedKph).toBeNull();
    // Max speed reflects the real 45 km/h fix, not the 70,300 km/h glitch.
    expect(result.summary?.maxSpeedKph).toBe(45);
    expect(result.trips[0]?.summary?.maxSpeedKph).toBe(45);
  });

  it("rejects a window longer than 31 days (Zod refine)", async () => {
    const { ctx } = makeTrackCtx();
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(
      caller.vehicleTrack({ vehicleId: "veh1", from, to: new Date("2026-08-01T00:00:00Z") }),
    ).rejects.toThrow();
  });

  it("rejects an anonymous caller (staffProcedure)", async () => {
    const ctx = {
      prisma: {},
      user: null,
      session: null,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["vehicleTrack"]>[0];
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(caller.vehicleTrack({ vehicleId: "veh1", from, to })).rejects.toThrow();
  });
});

describe("fleet.vehicleTrackAuthoritative", () => {
  function makeAuthCtx(
    over: { role?: "STAFF" | "MANAGER"; trackerId?: string | null; telemetry?: Array<Record<string, unknown>> } = {},
  ) {
    const telemetryFindMany = vi.fn().mockResolvedValue(over.telemetry ?? []);
    const telemetryCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const bookingFindMany = vi.fn().mockResolvedValue([]);
    const vehicleFindUnique = vi.fn().mockResolvedValue({ gpsTrackerId: over.trackerId ?? null });
    const prisma = {
      vehicleTelemetry: { findMany: telemetryFindMany, createMany: telemetryCreateMany },
      booking: { findMany: bookingFindMany },
      vehicle: { findUnique: vehicleFindUnique },
    };
    const role = over.role ?? "MANAGER";
    const ctx = {
      prisma,
      user: { id: "mgr1", role },
      session: { user: { id: "mgr1", role } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["vehicleTrackAuthoritative"]>[0];
    return { ctx, telemetryCreateMany };
  }

  const from = new Date("2026-06-01T00:00:00Z");
  const to = new Date("2026-06-02T00:00:00Z");

  it("maps the full GPS51 record set including odometer, voltage and status", async () => {
    vi.mocked(queryTracks).mockResolvedValue([
      {
        deviceid: "dev1",
        updatetime: Date.UTC(2026, 5, 1, 9, 0, 0),
        callat: -27.5,
        callon: 153.0,
        speed: 42000, // GPS51 metres/hour → 42 km/h
        course: 90,
        totaldistance: 1500, // metres → 1.5 km
        voltagepercent: 88,
        moving: 1,
        strstatusen: "ACC On",
      },
    ]);
    const { ctx, telemetryCreateMany } = makeAuthCtx({ trackerId: "dev1" });
    const caller = fleetRouter.createCaller(ctx as never);

    const result = await caller.vehicleTrackAuthoritative({ vehicleId: "veh1", from, to });

    expect(result.source).toBe("gps51");
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({
      lat: -27.5,
      lng: 153.0,
      speedKph: 42,
      headingDeg: 90,
      odometerKm: 1.5,
      batteryPct: 88,
      moving: true,
      ignitionOn: true,
      statusText: "ACC On",
    });
    // Persisted in km/h too (speed metres/hour ÷ 1000).
    expect(
      (telemetryCreateMany.mock.calls[0]?.[0] as { data?: Array<{ speedKph?: number }> })?.data?.[0]?.speedKph,
    ).toBe(42);
    // The pull is cached into our telemetry so it survives a refresh.
    expect(telemetryCreateMany).toHaveBeenCalledTimes(1);
    const createArgs = telemetryCreateMany.mock.calls[0]?.[0] as {
      data?: Array<{ source?: string }>;
      skipDuplicates?: boolean;
    };
    expect(createArgs?.skipDuplicates).toBe(true);
    expect(createArgs?.data?.[0]?.source).toBe("gps51-track");
  });

  it("falls back to stored telemetry when the vehicle has no tracker", async () => {
    const { ctx, telemetryCreateMany } = makeAuthCtx({ trackerId: null });
    const caller = fleetRouter.createCaller(ctx as never);

    const result = await caller.vehicleTrackAuthoritative({ vehicleId: "veh1", from, to });

    expect(result.source).toBe("stored");
    expect(result.reason).toBe("no tracker assigned");
    expect(queryTracks).not.toHaveBeenCalled();
    expect(telemetryCreateMany).not.toHaveBeenCalled();
  });

  it("rejects a STAFF caller (managerProcedure)", async () => {
    const { ctx } = makeAuthCtx({ role: "STAFF", trackerId: "dev1" });
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(
      caller.vehicleTrackAuthoritative({ vehicleId: "veh1", from, to }),
    ).rejects.toThrow();
  });
});

describe("segmentTrack", () => {
  const pt = (
    minute: number,
    over: { speedKph?: number | null; ignitionOn?: boolean | null; moving?: boolean | null } = {},
  ) => ({
    lat: -27.5 + minute * 0.001,
    lng: 153.0 + minute * 0.001,
    speedKph: over.speedKph === undefined ? 30 : over.speedKph,
    timestamp: new Date(Date.UTC(2026, 5, 1, 9, minute, 0)),
    headingDeg: null,
    ignitionOn: over.ignitionOn ?? null,
    batteryPct: null,
    odometerKm: null,
    voltage: null,
    moving: over.moving ?? null,
    statusText: null,
    bookingId: null,
    bookingReference: null,
  });

  it("keeps a continuous moving run as one trip with no parking", () => {
    const { trips, parkings } = segmentTrack([pt(0), pt(1), pt(2), pt(3)]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.points).toHaveLength(4);
    expect(parkings).toEqual([]);
  });

  it("treats speed as primary even when ignition reports ACC-off (voltage-only trackers)", () => {
    // 30 km/h with ACC permanently "off" must still be a trip, never a park.
    const { trips, parkings } = segmentTrack([
      pt(0, { ignitionOn: false }),
      pt(1, { ignitionOn: false }),
      pt(2, { ignitionOn: false }),
    ]);
    expect(trips).toHaveLength(1);
    expect(parkings).toEqual([]);
  });

  it("emits a parking for a stationary dwell between two trips", () => {
    const { trips, parkings } = segmentTrack([
      pt(0), pt(1), // moving
      pt(2, { speedKph: 0 }), pt(3, { speedKph: 0 }), pt(4, { speedKph: 0 }), // 2-min stop
      pt(5), pt(6), // moving again
    ]);
    expect(trips).toHaveLength(2);
    expect(parkings).toHaveLength(1);
    // Dwell stretches to the next trip's start (min 2 → min 5).
    expect(parkings[0]?.durationMinutes).toBe(3);
  });

  it("folds a brief sub-threshold stop into the surrounding trip", () => {
    const { trips, parkings } = segmentTrack([
      pt(0), pt(1), pt(2, { speedKph: 0 }), pt(3), pt(4), // single 0 fix < MIN_PARK_MINUTES
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.points).toHaveLength(5);
    expect(parkings).toEqual([]);
  });

  it("splits a long reporting gap into a parking, even between moving runs", () => {
    const { trips, parkings } = segmentTrack([pt(0), pt(1), pt(20), pt(21)]);
    expect(trips).toHaveLength(2);
    expect(parkings).toHaveLength(1);
    expect(parkings[0]?.durationMinutes).toBe(19);
  });

  it("falls back to gap-only trips when no movement signal is present", () => {
    const { trips, parkings } = segmentTrack([
      pt(0, { speedKph: null }), pt(1, { speedKph: null }),
      pt(20, { speedKph: null }), pt(21, { speedKph: null }),
    ]);
    expect(trips).toHaveLength(2); // gap split only
    expect(parkings).toEqual([]);
  });

  it("returns no trips or parkings for an empty breadcrumb", () => {
    expect(segmentTrack([])).toEqual({ trips: [], parkings: [] });
  });
});

describe("tollPointFromNotes", () => {
  it("extracts the toll point from a Linkt note", () => {
    expect(
      tollPointFromNotes("Toll: M5 East Tunnel. Source: ABC123 | 12.34"),
    ).toBe("M5 East Tunnel");
  });

  it("returns null for a placeholder toll point", () => {
    expect(tollPointFromNotes("Toll: —. Source: ABC123")).toBeNull();
  });

  it("returns null when notes are absent or unstructured", () => {
    expect(tollPointFromNotes(null)).toBeNull();
    expect(tollPointFromNotes("Manually recorded toll")).toBeNull();
  });
});

describe("fleet depot scoping (B1 IDOR fix)", () => {
  function makeScopedCtx(role: "STAFF" | "MANAGER", depotId: string | null) {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { vehicle: { findMany } };
    const ctx = {
      prisma,
      user: { id: "u1", role, depotId },
      session: { user: { id: "u1", role, depotId } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["auditVehicles"]>[0];
    return { ctx, findMany };
  }

  it("auditVehicles pins depot-assigned STAFF to their own depot", async () => {
    const { ctx, findMany } = makeScopedCtx("STAFF", "depot-a");
    const caller = fleetRouter.createCaller(ctx as never);
    await caller.auditVehicles({ depotId: "depot-b" });
    const args = findMany.mock.calls[0]?.[0] as { where?: { depotId?: string } };
    expect(args?.where?.depotId).toBe("depot-a");
  });

  it("auditVehicles lets MANAGER+ filter any depot", async () => {
    const { ctx, findMany } = makeScopedCtx("MANAGER", "depot-a");
    const caller = fleetRouter.createCaller(ctx as never);
    await caller.auditVehicles({ depotId: "depot-b" });
    const args = findMany.mock.calls[0]?.[0] as { where?: { depotId?: string } };
    expect(args?.where?.depotId).toBe("depot-b");
  });

  it("attentionList scopes depot-assigned STAFF to their own depot", async () => {
    const { ctx, findMany } = makeScopedCtx("STAFF", "depot-a");
    const caller = fleetRouter.createCaller(ctx as never);
    await caller.attentionList({ page: 1, pageSize: 25, sortBy: "dueDate", sortDir: "asc" });
    const args = findMany.mock.calls[0]?.[0] as { where?: { depotId?: string } };
    expect(args?.where?.depotId).toBe("depot-a");
  });
});

// ---------------------------------------------------------------------------
// GPS51 live tracking
// ---------------------------------------------------------------------------
function makeGpsCtx(over: {
  role?: "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";
  anon?: boolean;
  live?: unknown[];
  runs?: unknown[];
  dupTracker?: boolean;
  vehicle?: Record<string, unknown> | null;
  telemetry?: unknown[];
  booking?: Record<string, unknown> | null;
} = {}) {
  const prisma = {
    vehicleLivePosition: {
      // The freshness sample query filters on timestamp; the live-map query
      // doesn't. Serve `over.live` only to the latter so `{}` fixture rows
      // never reach the freshness mapper (which reads `timestamp.getTime()`).
      findMany: vi.fn().mockImplementation((args?: { where?: { timestamp?: unknown } }) =>
        Promise.resolve(args?.where?.timestamp ? [] : (over.live ?? [])),
      ),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue((over.live ?? []).length),
    },
    gps51Sync: { findMany: vi.fn().mockResolvedValue(over.runs ?? []) },
    systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    vehicleTelemetry: {
      findMany: vi.fn().mockResolvedValue(over.telemetry ?? []),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    booking: { findUnique: vi.fn().mockResolvedValue(over.booking ?? null) },
    vehicle: {
      findUnique: vi.fn().mockResolvedValue(over.vehicle ?? { id: "veh1", internalCode: "MTB-1" }),
      findFirst: vi.fn().mockResolvedValue(over.dupTracker ? { id: "other" } : null),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "veh1", ...data }),
      ),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const role = over.role ?? "STAFF";
  const ctx = over.anon
    ? { prisma, user: null, session: null, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, reqId: "r1" }
    : {
        prisma,
        user: { id: "u1", role },
        session: { user: { id: "u1", role } },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        reqId: "r1",
      };
  return { ctx: ctx as never, prisma };
}

describe("fleet.liveLocations", () => {
  it("maps live positions for tracked vehicles", async () => {
    const { ctx, prisma } = makeGpsCtx({
      live: [
        {
          deviceId: "19210047052",
          vehicleId: "veh1",
          vehicle: { id: "veh1", internalCode: "MTB-1", rego: "ABC", make: "Honda", model: "PCX" },
          latitude: -27.4,
          longitude: 153.0,
          speedKph: 20,
          headingDeg: 90,
          ignitionOn: true,
          batteryPct: 80,
          moving: true,
          timestamp: new Date(),
        },
      ],
    });
    const caller = fleetRouter.createCaller(ctx);
    const res = await caller.liveLocations();
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ deviceId: "19210047052", vehicleId: "veh1", moving: true });
    // only tracked vehicles (vehicleId not null)
    expect((prisma.vehicleLivePosition.findMany.mock.calls[0]?.[0] as { where?: unknown }).where).toMatchObject({
      vehicleId: { not: null },
    });
  });

  it("rejects an anonymous caller (staffProcedure)", async () => {
    const { ctx } = makeGpsCtx({ anon: true });
    const caller = fleetRouter.createCaller(ctx);
    await expect(caller.liveLocations()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("fleet.reverseGeocode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a human-readable address for a coordinate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          display_name: "12, Smith Street, Lewisham, NSW, 2049, Australia",
          address: {
            house_number: "12",
            road: "Smith Street",
            suburb: "Lewisham",
            state: "New South Wales",
            postcode: "2049",
            country: "Australia",
          },
        }),
      }),
    );
    const { ctx } = makeGpsCtx();
    const caller = fleetRouter.createCaller(ctx);
    const res = await caller.reverseGeocode({ lat: -33.90973, lng: 151.15559 });
    expect(res.address).toBe("12 Smith Street, Lewisham NSW 2049");
  });

  it("returns a null address when the lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { ctx } = makeGpsCtx();
    const caller = fleetRouter.createCaller(ctx);
    const res = await caller.reverseGeocode({ lat: 0, lng: 0 });
    expect(res.address).toBeNull();
  });

  it("rejects an anonymous caller (staffProcedure)", async () => {
    const { ctx } = makeGpsCtx({ anon: true });
    const caller = fleetRouter.createCaller(ctx);
    await expect(
      caller.reverseGeocode({ lat: 0, lng: 0 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("fleet.gps51SyncStatus", () => {
  it("returns recent runs plus the tracked-device count and last daily-track run", async () => {
    const { ctx, prisma } = makeGpsCtx({
      runs: [{ id: "s1", status: "SUCCESS", startedAt: new Date(), finishedAt: new Date(), devicesSeen: 2, recordsWritten: 5, error: null }],
      live: [{}, {}],
    });
    prisma.systemSetting.findUnique.mockResolvedValue({
      value: { status: "SUCCESS", recordsWritten: 99 },
    });
    const caller = fleetRouter.createCaller(ctx);
    const res = await caller.gps51SyncStatus();
    expect(res.trackedDevices).toBe(2);
    expect(res.runs[0]).toMatchObject({ id: "s1", status: "SUCCESS", devicesSeen: 2 });
    expect(res.dailyTrackSync).toMatchObject({ status: "SUCCESS", recordsWritten: 99 });
  });
});

describe("fleet.gps51DailySyncNow", () => {
  it("runs the daily full-track sync inline when no worker queue is available", async () => {
    vi.mocked(runGps51DailyTrackSync).mockResolvedValue({
      status: "SUCCESS",
      devicesTotal: 3,
      devicesSucceeded: 3,
      recordsWritten: 42,
      deviceErrors: [],
    });
    const { ctx } = makeGpsCtx({ role: "MANAGER" });
    const caller = fleetRouter.createCaller(ctx);

    const res = await caller.gps51DailySyncNow({ hoursBack: 48 });

    expect(res).toMatchObject({ mode: "inline", status: "SUCCESS", recordsWritten: 42 });
    expect(runGps51DailyTrackSync).toHaveBeenCalledWith(expect.anything(), { hoursBack: 48 });
  });

  it("rejects a STAFF caller (managerProcedure)", async () => {
    const { ctx } = makeGpsCtx({ role: "STAFF" });
    const caller = fleetRouter.createCaller(ctx);
    await expect(caller.gps51DailySyncNow({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an out-of-range hoursBack (Zod bound)", async () => {
    const { ctx } = makeGpsCtx({ role: "MANAGER" });
    const caller = fleetRouter.createCaller(ctx);
    await expect(caller.gps51DailySyncNow({ hoursBack: 0 })).rejects.toThrow();
  });
});

describe("fleet.bookingTrip", () => {
  it("renders a trip summary from stored telemetry over the rental window", async () => {
    const t0 = new Date("2026-06-15T00:00:00Z");
    const { ctx } = makeGpsCtx({
      booking: {
        vehicleId: "veh1",
        pickupDateTime: t0,
        returnDateTime: new Date("2026-06-15T02:00:00Z"),
        actualPickupDateTime: null,
        actualReturnDateTime: null,
      },
      telemetry: [
        { timestamp: t0, latitude: -27.4, longitude: 153.0, speedKph: 0 },
        { timestamp: new Date("2026-06-15T00:30:00Z"), latitude: -27.45, longitude: 153.05, speedKph: 50 },
      ],
    });
    const caller = fleetRouter.createCaller(ctx);
    const res = await caller.bookingTrip({ bookingId: "bk1" });
    expect(res.vehicleId).toBe("veh1");
    expect(res.points).toHaveLength(2);
    expect(res.summary?.maxSpeedKph).toBe(50);
    expect(res.summary?.distanceKm).toBeGreaterThan(0);
  });

  it("throws NOT_FOUND for a missing booking", async () => {
    const { ctx } = makeGpsCtx({ booking: null });
    const caller = fleetRouter.createCaller(ctx);
    await expect(caller.bookingTrip({ bookingId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("fleet.updateVehicle gpsTrackerId", () => {
  it("rejects a tracker ID already assigned to another vehicle", async () => {
    const { ctx } = makeGpsCtx({
      role: "MANAGER",
      vehicle: { id: "veh1", internalCode: "MTB-1", gpsTrackerId: null, depotId: "d1" },
      dupTracker: true,
    });
    const caller = fleetRouter.createCaller(ctx);
    await expect(
      caller.updateVehicle({ id: "veh1", gpsTrackerId: "19210047052" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("clears the tracker when given an empty string", async () => {
    const { ctx, prisma } = makeGpsCtx({
      role: "MANAGER",
      vehicle: { id: "veh1", internalCode: "MTB-1", gpsTrackerId: "19210047052", depotId: "d1" },
    });
    const caller = fleetRouter.createCaller(ctx);
    await caller.updateVehicle({ id: "veh1", gpsTrackerId: "" });
    const data = (prisma.vehicle.update.mock.calls[0]?.[0] as { data?: Record<string, unknown> }).data;
    expect(data?.gpsTrackerId).toBeNull();
  });
});

describe("fleet.chargeCustomerForIncident", () => {
  function makeIncidentCtx(over: {
    role?: "STAFF" | "MANAGER";
    booking?: Record<string, unknown> | null;
    customerLiable?: boolean;
    bondLedger?: Record<string, unknown> | null;
    existingPayment?: { id: string } | null;
  } = {}) {
    const bondLedger =
      over.bondLedger === undefined
        ? {
            heldAmount: 500,
            capturedAmount: 0,
            status: "HELD",
            stripePaymentIntentId: "pi_bond_1",
            deductions: [],
          }
        : over.bondLedger;
    const booking =
      over.booking === undefined
        ? { id: "bk1", customerId: "cust1", bondLedger, pickupDepot: { slug: "brisbane" } }
        : over.booking;
    const incident = {
      id: "incident1",
      incidentNumber: "2026-0042",
      customerLiable: over.customerLiable ?? true,
      customerChargeAmount: null,
      actualDamageCost: null,
      resolvedAt: null,
      booking,
    };
    const paymentCreate = vi
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: `pay-${data.reference}`, ...data }),
      );
    const bookingUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      incident: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(incident),
        update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: "incident1", ...data }),
        ),
      },
      payment: {
        findFirst: vi.fn().mockResolvedValue(over.existingPayment ?? null),
        create: paymentCreate,
      },
      bondLedger: { update: vi.fn().mockResolvedValue({}) },
      booking: { update: bookingUpdate },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    capturePaymentIntentMock.mockResolvedValue({
      id: "pi_bond_1",
      status: "succeeded",
      amountReceivedCents: 50000,
      latestChargeId: "ch_bond_1",
      captured: true,
    });
    const role = over.role ?? "MANAGER";
    const ctx = {
      prisma,
      user: { id: "mgr1", role },
      session: { user: { id: "mgr1", role } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["chargeCustomerForIncident"]>[0];
    return { ctx, prisma, paymentCreate, bookingUpdate };
  }

  it("splits a bond+card charge and raises balanceDue by exactly the card share, GST on both rows", async () => {
    const { ctx, paymentCreate, bookingUpdate } = makeIncidentCtx();
    const caller = fleetRouter.createCaller(ctx as never);

    const res = await caller.chargeCustomerForIncident({ incidentId: "incident1", amount: 800 });

    expect(res.fromBond).toBe(500);
    expect(res.fromCard).toBe(300);

    const created = paymentCreate.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    const bondRow = created.find((d) => d.reference === "INC-2026-0042");
    const cardRow = created.find((d) => d.reference === "INC-2026-0042-CARD");
    expect(bondRow).toMatchObject({ type: "DAMAGE_CHARGE", status: "SUCCEEDED", amount: 500 });
    expect(cardRow).toMatchObject({ type: "DAMAGE_CHARGE", status: "PENDING", amount: 300 });
    // GST-inclusive taxable supply: both rows carry gstAmount = amount / 11
    // (BAS export reads Payment.gstAmount).
    expect(Number(bondRow?.gstAmount)).toBeCloseTo(45.45, 2);
    expect(Number(cardRow?.gstAmount)).toBeCloseTo(27.27, 2);

    // Raise half of the balance-due contract: only the PENDING card overflow
    // enters balanceDue — the bond capture is settled money, never dunned.
    expect(bookingUpdate).toHaveBeenCalledTimes(1);
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "bk1" },
      data: { balanceDue: { increment: 300 } },
    });

    // The adjustment-note line items carry explicit GST too.
    expect(tryIssueAdjustmentForBookingMock).toHaveBeenCalledTimes(2);
    const noteGsts = tryIssueAdjustmentForBookingMock.mock.calls.map(
      (c) =>
        (c[0] as { lineItems: Array<{ gstAmount?: number }> }).lineItems[0]?.gstAmount,
    );
    expect(noteGsts).toEqual(expect.arrayContaining([45.45, 27.27]));
  });

  it("does not touch balanceDue when the bond covers the whole charge", async () => {
    const { ctx, bookingUpdate } = makeIncidentCtx();
    const caller = fleetRouter.createCaller(ctx as never);

    const res = await caller.chargeCustomerForIncident({ incidentId: "incident1", amount: 400 });

    expect(res.fromBond).toBe(400);
    expect(res.fromCard).toBe(0);
    expect(bookingUpdate).not.toHaveBeenCalled();
  });

  it("rejects an incident with no linked booking", async () => {
    const { ctx } = makeIncidentCtx({ booking: null });
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(
      caller.chargeCustomerForIncident({ incidentId: "incident1", amount: 100 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(capturePaymentIntentMock).not.toHaveBeenCalled();
  });

  it("rejects an incident not marked customerLiable", async () => {
    const { ctx } = makeIncidentCtx({ customerLiable: false });
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(
      caller.chargeCustomerForIncident({ incidentId: "incident1", amount: 100 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("CONFLICTs on a second call once the charge reference exists (idempotency)", async () => {
    const { ctx, paymentCreate } = makeIncidentCtx({ existingPayment: { id: "pay-prior" } });
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(
      caller.chargeCustomerForIncident({ incidentId: "incident1", amount: 800 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(capturePaymentIntentMock).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("rejects a STAFF caller (managerProcedure)", async () => {
    const { ctx } = makeIncidentCtx({ role: "STAFF" });
    const caller = fleetRouter.createCaller(ctx as never);

    await expect(
      caller.chargeCustomerForIncident({ incidentId: "incident1", amount: 100 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
