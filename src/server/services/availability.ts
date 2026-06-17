import type { Prisma, PrismaClient } from "@prisma/client";
import { BOOKING_RULES } from "@/lib/constants";

/** Either the top-level client or a transaction — everything in this module
 *  works against both. Callers that need serialisation (the allocation
 *  paths) pass a `TransactionClient`; callers that only read pass the
 *  regular `PrismaClient`. */
export type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * A1-a: take a Postgres transaction-scoped advisory lock keyed on the
 * (depot, category) pair so concurrent allocations serialise within that
 * pair. Lock is automatically released at commit/rollback. We use the
 * two-arg form of `pg_advisory_xact_lock(int, int)` with `hashtext` on
 * each of the two cuid strings — cheap, deterministic, no collision risk
 * across other advisory lock users because the keys live in a dedicated
 * 64-bit space derived from our own hashes.
 *
 * MUST be called inside a `$transaction`. Calling outside one makes the
 * lock transaction-less and it releases immediately.
 */
export async function acquireAllocationLock(
  tx: Prisma.TransactionClient,
  depotId: string,
  categoryId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${depotId}), hashtext(${categoryId}))`;
}

/**
 * A1-b safety net: the exclusion constraint `Booking_no_overlap` raises
 * SQLSTATE 23P01 if two overlapping bookings for the same vehicle try to
 * coexist. Prisma wraps this as a generic error with the constraint name
 * somewhere in the message. We classify it here so callers can re-throw
 * a clean CONFLICT instead of a 500.
 */
export function isBookingOverlapViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; meta?: { code?: string } };
  const msg = e.message ?? "";
  if (msg.includes("Booking_no_overlap")) return true;
  // Postgres SQLSTATE for exclusion constraint violation
  if (e.meta?.code === "23P01" || msg.includes("23P01")) return true;
  return false;
}

// A vehicle whose rego / CTP / insurance lapses during the rental window
// is not legally rentable. Null = not yet recorded (grandfathered data),
// treated as pass. AND'd into the top-level where clause because Prisma's
// null-OR-compare pattern has to live at the `AND`/`OR` level.
function vehicleDocsValidUntil(ret: Date) {
  return [
    { OR: [{ regoExpiry: null }, { regoExpiry: { gte: ret } }] },
    { OR: [{ ctpExpiry: null }, { ctpExpiry: { gte: ret } }] },
    { OR: [{ insuranceExpiry: null }, { insuranceExpiry: { gte: ret } }] },
  ];
}

/**
 * A5: find vehicles that have an *open* (not yet completed) maintenance
 * work order whose scheduled window overlaps [pickup, ret]. Returned set
 * is the vehicle ids to subtract from the candidate pool. Ignores work
 * orders without a schedule — they're manual/ad-hoc and will flip the
 * vehicle's status to IN_MAINTENANCE when started, which the primary
 * status filter already excludes.
 */
async function vehiclesBlockedByScheduledWorkOrders(
  prisma: PrismaLike,
  vehicleIds: string[],
  pickup: Date,
  ret: Date,
): Promise<Set<string>> {
  if (vehicleIds.length === 0) return new Set();
  const wos = await prisma.maintenanceWorkOrder.findMany({
    where: {
      vehicleId: { in: vehicleIds },
      status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS"] },
      scheduledStartAt: { not: null, lt: ret },
      scheduledEndAt: { not: null, gt: pickup },
    },
    select: { vehicleId: true },
  });
  return new Set(wos.map((w) => w.vehicleId));
}

export async function countAvailable(
  prisma: PrismaLike,
  args: { categoryId: string; depotId: string; pickup: Date; ret: Date },
) {
  const bufferMs = BOOKING_RULES.bufferHoursBetweenBookings * 60 * 60 * 1000;
  const pickupBuf = new Date(args.pickup.getTime() - bufferMs);
  const retBuf = new Date(args.ret.getTime() + bufferMs);

  const vehicles = await prisma.vehicle.findMany({
    where: {
      categoryId: args.categoryId,
      depotId: args.depotId,
      isActive: true,
      status: { notIn: ["PENDING", "SOLD", "END_OF_LIFE", "STOLEN", "WRITTEN_OFF", "ACCIDENT_REPAIRS"] },
      AND: vehicleDocsValidUntil(args.ret),
    },
    select: { id: true },
  });
  const ids = vehicles.map((v) => v.id);
  if (ids.length === 0) return { total: 0, available: 0 };

  const conflicting = await prisma.booking.findMany({
    where: {
      vehicleId: { in: ids },
      status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "OVERDUE"] },
      pickupDateTime: { lt: retBuf },
      returnDateTime: { gt: pickupBuf },
    },
    select: { vehicleId: true },
  });
  const blocked = new Set(conflicting.map((b) => b.vehicleId));
  const woBlocked = await vehiclesBlockedByScheduledWorkOrders(
    prisma,
    ids,
    args.pickup,
    args.ret,
  );
  for (const id of woBlocked) blocked.add(id);
  return { total: ids.length, available: ids.filter((id) => !blocked.has(id)).length };
}

export async function listAvailableVehicles(
  prisma: PrismaLike,
  args: { pickup: Date; ret: Date; categoryId?: string; depotId?: string; limit?: number },
) {
  const bufferMs = BOOKING_RULES.bufferHoursBetweenBookings * 60 * 60 * 1000;
  const pickupBuf = new Date(args.pickup.getTime() - bufferMs);
  const retBuf = new Date(args.ret.getTime() + bufferMs);

  const vehicles = await prisma.vehicle.findMany({
    where: {
      isActive: true,
      status: { notIn: ["PENDING", "SOLD", "END_OF_LIFE", "STOLEN", "WRITTEN_OFF", "ACCIDENT_REPAIRS", "IN_MAINTENANCE"] },
      AND: vehicleDocsValidUntil(args.ret),
      ...(args.categoryId ? { categoryId: args.categoryId } : {}),
      ...(args.depotId ? { depotId: args.depotId } : {}),
    },
    include: {
      category: true,
      depot: true,
      // M-6: per-unit engine capacity for the booking card. The category's
      // engineCapacity is coarse (every unit in a category shares it), so the
      // card prefers the linked catalogue model's cc and hides the field when
      // unavailable rather than showing a misleading shared figure.
      catalogueModel: { select: { engineCapacityCc: true } },
      images: { where: { isPrimary: true }, take: 1 },
    },
    orderBy: [{ depotId: "asc" }, { currentOdometerKm: "asc" }],
  });
  if (vehicles.length === 0) return [];

  const ids = vehicles.map((v) => v.id);
  const conflicting = await prisma.booking.findMany({
    where: {
      vehicleId: { in: ids },
      status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "OVERDUE"] },
      pickupDateTime: { lt: retBuf },
      returnDateTime: { gt: pickupBuf },
    },
    select: { vehicleId: true },
  });
  const blocked = new Set(conflicting.map((b) => b.vehicleId));
  const woBlocked = await vehiclesBlockedByScheduledWorkOrders(
    prisma,
    ids,
    args.pickup,
    args.ret,
  );
  for (const id of woBlocked) blocked.add(id);
  const free = vehicles.filter((v) => !blocked.has(v.id));
  return args.limit ? free.slice(0, args.limit) : free;
}

export async function isVehicleFree(
  prisma: PrismaLike,
  args: {
    vehicleId: string;
    pickup: Date;
    ret: Date;
    /** Exclude this booking from the clash search. Used by extension flows
     *  where the booking being modified would otherwise self-match — its
     *  current `returnDateTime` sits exactly at the start of the requested
     *  window, and the buffer pulls it inside the search range. */
    excludeBookingId?: string;
  },
): Promise<boolean> {
  const bufferMs = BOOKING_RULES.bufferHoursBetweenBookings * 60 * 60 * 1000;
  const pickupBuf = new Date(args.pickup.getTime() - bufferMs);
  const retBuf = new Date(args.ret.getTime() + bufferMs);
  const clash = await prisma.booking.findFirst({
    where: {
      vehicleId: args.vehicleId,
      status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "OVERDUE"] },
      pickupDateTime: { lt: retBuf },
      returnDateTime: { gt: pickupBuf },
      ...(args.excludeBookingId ? { id: { not: args.excludeBookingId } } : {}),
    },
    select: { id: true },
  });
  if (clash) return false;
  const woBlocked = await vehiclesBlockedByScheduledWorkOrders(
    prisma,
    [args.vehicleId],
    args.pickup,
    args.ret,
  );
  return !woBlocked.has(args.vehicleId);
}

export async function allocateVehicle(
  prisma: PrismaLike,
  args: { categoryId: string; depotId: string; pickup: Date; ret: Date },
): Promise<string | null> {
  const bufferMs = BOOKING_RULES.bufferHoursBetweenBookings * 60 * 60 * 1000;
  const pickupBuf = new Date(args.pickup.getTime() - bufferMs);
  const retBuf = new Date(args.ret.getTime() + bufferMs);

  const candidates = await prisma.vehicle.findMany({
    where: {
      categoryId: args.categoryId,
      depotId: args.depotId,
      isActive: true,
      status: "AVAILABLE",
      AND: vehicleDocsValidUntil(args.ret),
    },
    orderBy: { currentOdometerKm: "asc" },
  });
  if (candidates.length === 0) return null;

  const woBlocked = await vehiclesBlockedByScheduledWorkOrders(
    prisma,
    candidates.map((c) => c.id),
    args.pickup,
    args.ret,
  );

  for (const v of candidates) {
    if (woBlocked.has(v.id)) continue;
    const clash = await prisma.booking.findFirst({
      where: {
        vehicleId: v.id,
        status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "OVERDUE"] },
        pickupDateTime: { lt: retBuf },
        returnDateTime: { gt: pickupBuf },
      },
      select: { id: true },
    });
    if (!clash) return v.id;
  }
  return null;
}
