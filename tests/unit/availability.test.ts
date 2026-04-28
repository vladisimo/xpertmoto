import { test, expect, describe, beforeEach, afterEach, vi } from "vitest";
import {
  isVehicleFree,
  allocateVehicle,
  countAvailable,
  isBookingOverlapViolation,
} from "../../src/server/services/availability";

// Every scenario here hinges on a known "current time" relative to the
// fixed booking windows. Pin system time so the suite doesn't drift when
// run days/years after the dates used in setup, and any `new Date()` /
// `Date.now()` added later gets a deterministic reference.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-01T09:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

type Booking = {
  id?: string;
  vehicleId: string;
  status: string;
  pickupDateTime: Date;
  returnDateTime: Date;
};
type Vehicle = {
  id: string;
  categoryId: string;
  depotId: string;
  isActive: boolean;
  status: string;
  currentOdometerKm: number;
};

type ScheduledWorkOrder = {
  vehicleId: string;
  status: "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "AWAITING_PARTS" | "COMPLETED" | "CANCELLED";
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
};

function makeFake({
  vehicles,
  bookings,
  workOrders = [],
}: {
  vehicles: Vehicle[];
  bookings: Booking[];
  workOrders?: ScheduledWorkOrder[];
}) {
  return {
    vehicle: {
      findMany: async (args: {
        where?: { categoryId?: string; depotId?: string; status?: unknown };
        orderBy?: { currentOdometerKm?: "asc" | "desc" };
      }) => {
        const filtered = vehicles.filter((v) => {
          if (!v.isActive) return false;
          if (args.where?.categoryId && v.categoryId !== args.where.categoryId) return false;
          if (args.where?.depotId && v.depotId !== args.where.depotId) return false;
          const st = args.where?.status;
          if (st && typeof st === "object" && "notIn" in st) {
            const notIn = (st as { notIn: string[] }).notIn;
            if (notIn.includes(v.status)) return false;
          }
          if (typeof st === "string" && v.status !== st) return false;
          return true;
        });
        if (args.orderBy?.currentOdometerKm === "asc") {
          filtered.sort((a, b) => a.currentOdometerKm - b.currentOdometerKm);
        } else if (args.orderBy?.currentOdometerKm === "desc") {
          filtered.sort((a, b) => b.currentOdometerKm - a.currentOdometerKm);
        }
        return filtered;
      },
    },
    booking: {
      findFirst: async (args: {
        where: {
          vehicleId: string;
          pickupDateTime: { lt: Date };
          returnDateTime: { gt: Date };
          id?: { not: string };
        };
      }) => {
        const excludeId = args.where.id?.not;
        return (
          bookings.find(
            (b) =>
              b.vehicleId === args.where.vehicleId &&
              ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "OVERDUE"].includes(b.status) &&
              b.pickupDateTime < args.where.pickupDateTime.lt &&
              b.returnDateTime > args.where.returnDateTime.gt &&
              (excludeId === undefined || b.id !== excludeId),
          ) ?? null
        );
      },
      findMany: async (args: {
        where: { vehicleId: { in: string[] }; pickupDateTime: { lt: Date }; returnDateTime: { gt: Date } };
      }) => {
        return bookings.filter(
          (b) =>
            args.where.vehicleId.in.includes(b.vehicleId) &&
            ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "OVERDUE"].includes(b.status) &&
            b.pickupDateTime < args.where.pickupDateTime.lt &&
            b.returnDateTime > args.where.returnDateTime.gt,
        );
      },
    },
    maintenanceWorkOrder: {
      findMany: async (args: {
        where: {
          vehicleId: { in: string[] };
          status: { in: string[] };
          scheduledStartAt: { lt: Date; not: null };
          scheduledEndAt: { gt: Date; not: null };
        };
      }) => {
        const activeStatuses = new Set(args.where.status.in);
        const vehicleIds = new Set(args.where.vehicleId.in);
        return workOrders.filter(
          (w) =>
            vehicleIds.has(w.vehicleId) &&
            activeStatuses.has(w.status) &&
            w.scheduledStartAt !== null &&
            w.scheduledEndAt !== null &&
            w.scheduledStartAt < args.where.scheduledStartAt.lt &&
            w.scheduledEndAt > args.where.scheduledEndAt.gt,
        );
      },
    },
  } as unknown as Parameters<typeof isVehicleFree>[0];
}

const V: Vehicle = {
  id: "v1",
  categoryId: "cat1",
  depotId: "dep1",
  isActive: true,
  status: "AVAILABLE",
  currentOdometerKm: 1000,
};

test("isVehicleFree — no bookings returns true", async () => {
  const fake = makeFake({ vehicles: [V], bookings: [] });
  const free = await isVehicleFree(fake, {
    vehicleId: "v1",
    pickup: new Date("2026-04-10T10:00:00"),
    ret: new Date("2026-04-13T10:00:00"),
  });
  expect(free).toBe(true);
});

test("isVehicleFree — overlapping booking blocks", async () => {
  const fake = makeFake({
    vehicles: [V],
    bookings: [
      {
        vehicleId: "v1",
        status: "CONFIRMED",
        pickupDateTime: new Date("2026-04-12T10:00:00"),
        returnDateTime: new Date("2026-04-15T10:00:00"),
      },
    ],
  });
  const free = await isVehicleFree(fake, {
    vehicleId: "v1",
    pickup: new Date("2026-04-10T10:00:00"),
    ret: new Date("2026-04-13T10:00:00"),
  });
  expect(free).toBe(false);
});

test("isVehicleFree — buffer zone (within 2h of existing booking) blocks", async () => {
  const fake = makeFake({
    vehicles: [V],
    bookings: [
      {
        vehicleId: "v1",
        status: "ACTIVE",
        pickupDateTime: new Date("2026-04-10T08:00:00"),
        returnDateTime: new Date("2026-04-10T11:00:00"),
      },
    ],
  });
  // Request starts at 12:00 — only 1h after prior return, inside 2h buffer
  const free = await isVehicleFree(fake, {
    vehicleId: "v1",
    pickup: new Date("2026-04-10T12:00:00"),
    ret: new Date("2026-04-11T12:00:00"),
  });
  expect(free).toBe(false);
});

test("isVehicleFree — 3h gap between bookings clears buffer", async () => {
  const fake = makeFake({
    vehicles: [V],
    bookings: [
      {
        vehicleId: "v1",
        status: "ACTIVE",
        pickupDateTime: new Date("2026-04-10T08:00:00"),
        returnDateTime: new Date("2026-04-10T11:00:00"),
      },
    ],
  });
  const free = await isVehicleFree(fake, {
    vehicleId: "v1",
    pickup: new Date("2026-04-10T14:00:00"),
    ret: new Date("2026-04-11T14:00:00"),
  });
  expect(free).toBe(true);
});

// Regression: extending a booking would self-match the clash query because
// the booking's own returnDateTime sits at the start of the new window and
// the 2h pre-window buffer pulls it inside the search range. excludeBookingId
// suppresses the self-match.
test("isVehicleFree — excludeBookingId skips self-match for the same booking row", async () => {
  const fake = makeFake({
    vehicles: [V],
    bookings: [
      {
        id: "b-self",
        vehicleId: "v1",
        status: "CONFIRMED",
        pickupDateTime: new Date("2026-04-10T10:00:00"),
        returnDateTime: new Date("2026-04-12T10:00:00"),
      },
    ],
  });
  const free = await isVehicleFree(fake, {
    vehicleId: "v1",
    pickup: new Date("2026-04-12T10:00:00"),
    ret: new Date("2026-04-15T10:00:00"),
    excludeBookingId: "b-self",
  });
  expect(free).toBe(true);
});

test("isVehicleFree — excludeBookingId still blocks on a different conflicting booking", async () => {
  const fake = makeFake({
    vehicles: [V],
    bookings: [
      {
        id: "b-self",
        vehicleId: "v1",
        status: "CONFIRMED",
        pickupDateTime: new Date("2026-04-10T10:00:00"),
        returnDateTime: new Date("2026-04-12T10:00:00"),
      },
      {
        id: "b-other",
        vehicleId: "v1",
        status: "CONFIRMED",
        pickupDateTime: new Date("2026-04-13T10:00:00"),
        returnDateTime: new Date("2026-04-16T10:00:00"),
      },
    ],
  });
  const free = await isVehicleFree(fake, {
    vehicleId: "v1",
    pickup: new Date("2026-04-12T10:00:00"),
    ret: new Date("2026-04-15T10:00:00"),
    excludeBookingId: "b-self",
  });
  expect(free).toBe(false);
});

test("countAvailable — counts only non-conflicting vehicles", async () => {
  const vehicles: Vehicle[] = [
    { ...V, id: "v1" },
    { ...V, id: "v2" },
    { ...V, id: "v3" },
  ];
  const fake = makeFake({
    vehicles,
    bookings: [
      {
        vehicleId: "v2",
        status: "CONFIRMED",
        pickupDateTime: new Date("2026-04-11T10:00:00"),
        returnDateTime: new Date("2026-04-12T10:00:00"),
      },
    ],
  });
  const r = await countAvailable(fake, {
    categoryId: "cat1",
    depotId: "dep1",
    pickup: new Date("2026-04-10T10:00:00"),
    ret: new Date("2026-04-13T10:00:00"),
  });
  expect(r.total).toBe(3);
  expect(r.available).toBe(2);
});

describe("isBookingOverlapViolation", () => {
  test("identifies the exclusion constraint by name", () => {
    expect(
      isBookingOverlapViolation(
        new Error('conflicting key value violates exclusion constraint "Booking_no_overlap"'),
      ),
    ).toBe(true);
  });
  test("identifies the SQLSTATE", () => {
    expect(isBookingOverlapViolation({ meta: { code: "23P01" }, message: "boom" })).toBe(true);
    expect(isBookingOverlapViolation({ message: "SQLSTATE 23P01 somewhere" })).toBe(true);
  });
  test("ignores unrelated errors", () => {
    expect(isBookingOverlapViolation(new Error("connection refused"))).toBe(false);
    expect(isBookingOverlapViolation(null)).toBe(false);
    expect(isBookingOverlapViolation(undefined)).toBe(false);
    expect(isBookingOverlapViolation("string")).toBe(false);
  });
});

describe("A5 scheduled work orders block availability", () => {
  test("vehicle with open work order whose schedule overlaps is excluded", async () => {
    const fake = makeFake({
      vehicles: [V],
      bookings: [],
      workOrders: [
        {
          vehicleId: "v1",
          status: "OPEN",
          scheduledStartAt: new Date("2026-04-11T08:00:00"),
          scheduledEndAt: new Date("2026-04-11T12:00:00"),
        },
      ],
    });
    const free = await isVehicleFree(fake, {
      vehicleId: "v1",
      pickup: new Date("2026-04-11T10:00:00"),
      ret: new Date("2026-04-12T10:00:00"),
    });
    expect(free).toBe(false);
  });

  test("work order with non-overlapping window doesn't block", async () => {
    const fake = makeFake({
      vehicles: [V],
      bookings: [],
      workOrders: [
        {
          vehicleId: "v1",
          status: "ASSIGNED",
          scheduledStartAt: new Date("2026-04-20T08:00:00"),
          scheduledEndAt: new Date("2026-04-20T12:00:00"),
        },
      ],
    });
    const free = await isVehicleFree(fake, {
      vehicleId: "v1",
      pickup: new Date("2026-04-11T10:00:00"),
      ret: new Date("2026-04-12T10:00:00"),
    });
    expect(free).toBe(true);
  });

  test("completed work order doesn't block", async () => {
    const fake = makeFake({
      vehicles: [V],
      bookings: [],
      workOrders: [
        {
          vehicleId: "v1",
          status: "COMPLETED",
          scheduledStartAt: new Date("2026-04-11T08:00:00"),
          scheduledEndAt: new Date("2026-04-11T12:00:00"),
        },
      ],
    });
    const free = await isVehicleFree(fake, {
      vehicleId: "v1",
      pickup: new Date("2026-04-11T10:00:00"),
      ret: new Date("2026-04-12T10:00:00"),
    });
    expect(free).toBe(true);
  });

  test("countAvailable subtracts work-order-blocked vehicles", async () => {
    const vehicles: Vehicle[] = [
      { ...V, id: "v1" },
      { ...V, id: "v2" },
    ];
    const fake = makeFake({
      vehicles,
      bookings: [],
      workOrders: [
        {
          vehicleId: "v2",
          status: "IN_PROGRESS",
          scheduledStartAt: new Date("2026-04-11T08:00:00"),
          scheduledEndAt: new Date("2026-04-13T12:00:00"),
        },
      ],
    });
    const r = await countAvailable(fake, {
      categoryId: "cat1",
      depotId: "dep1",
      pickup: new Date("2026-04-11T10:00:00"),
      ret: new Date("2026-04-12T10:00:00"),
    });
    expect(r.total).toBe(2);
    expect(r.available).toBe(1);
  });
});

test("allocateVehicle — picks lowest-odometer free vehicle", async () => {
  const vehicles: Vehicle[] = [
    { ...V, id: "v-high", currentOdometerKm: 30000 },
    { ...V, id: "v-low", currentOdometerKm: 500 },
  ];
  const fake = makeFake({ vehicles, bookings: [] });
  const chosen = await allocateVehicle(fake, {
    categoryId: "cat1",
    depotId: "dep1",
    pickup: new Date("2026-04-10T10:00:00"),
    ret: new Date("2026-04-13T10:00:00"),
  });
  // countAvailable orders by odometer asc, so v-low should win
  expect(chosen).toBe("v-low");
});
