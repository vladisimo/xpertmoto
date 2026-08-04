import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as sharedPrisma } from "@/lib/prisma";
import { TYRE_RULES } from "@/lib/constants";

export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type NotReturnedBooking = {
  id: string;
  bookingReference: string;
  pickupDateTime: Date;
  returnDateTime: Date;
  overdueStage: number;
  hoursOverdue: number;
  status: "ACTIVE" | "OVERDUE" | "CHECKED_OUT";
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  vehicle: {
    id: string;
    internalCode: string;
    rego: string;
    regoState: string;
    make: string;
    model: string;
    year: number;
    colour: string;
    images: { url: string; caption: string | null }[];
  } | null;
  category: { name: string };
  totalAmount: number;
  balanceDue: number;
};

export async function findNotReturnedBookings(
  depotId?: string,
  db: PrismaLike = sharedPrisma,
): Promise<NotReturnedBooking[]> {
  const now = new Date();
  const rows = await db.booking.findMany({
    where: {
      status: { in: ["ACTIVE", "OVERDUE", "CHECKED_OUT"] },
      returnDateTime: { lt: now },
      ...(depotId ? { returnDepotId: depotId } : {}),
    },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      vehicle: {
        select: {
          id: true,
          internalCode: true,
          rego: true,
          regoState: true,
          make: true,
          model: true,
          year: true,
          colour: true,
          images: {
            orderBy: [{ isPrimary: "desc" as const }, { displayOrder: "asc" as const }],
            take: 1,
            select: { url: true, caption: true },
          },
        },
      },
      category: { select: { name: true } },
    },
    orderBy: { returnDateTime: "asc" },
  });
  return rows.map((b) => ({
    id: b.id,
    bookingReference: b.bookingReference,
    pickupDateTime: b.pickupDateTime,
    returnDateTime: b.returnDateTime,
    overdueStage: b.overdueStage,
    hoursOverdue: Math.max(0, Math.floor((now.getTime() - b.returnDateTime.getTime()) / 3_600_000)),
    status: b.status as NotReturnedBooking["status"],
    customer: b.customer,
    vehicle: b.vehicle,
    category: b.category,
    totalAmount: Number(b.totalAmount),
    balanceDue: Number(b.balanceDue),
  }));
}

export type UnallocatedBooking = {
  id: string;
  bookingReference: string;
  status: string;
  pickupDateTime: Date;
  categoryName: string;
  customerName: string;
};

export type MaintenanceConflictRow = {
  bookingId: string;
  bookingReference: string;
  pickupDateTime: Date;
  returnDateTime: Date;
  vehicleCode: string;
  workOrderId: string;
  workOrderNumber: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
};

export type StatusMismatchRow = {
  vehicleId: string;
  vehicleCode: string;
  vehicleStatus: string;
  observed: "AVAILABLE_BUT_ON_HIRE" | "RENTED_BUT_NO_ACTIVE_BOOKING";
  bookingId?: string;
  bookingReference?: string;
};

export type DocsExpiringRow = {
  vehicleId: string;
  vehicleCode: string;
  bookingId: string;
  bookingReference: string;
  pickupDateTime: Date;
  expiringDoc: "rego" | "ctp" | "insurance";
  expiresAt: Date;
};

export type CalendarMistakes = {
  unallocated: UnallocatedBooking[];
  maintenanceConflicts: MaintenanceConflictRow[];
  statusMismatches: StatusMismatchRow[];
  docsExpiringWithBooking: DocsExpiringRow[];
  total: number;
};

type MaintenanceConflictRawRow = {
  bookingId: string;
  bookingReference: string;
  pickupDateTime: Date;
  returnDateTime: Date;
  vehicleCode: string;
  workOrderId: string;
  workOrderNumber: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
};

type DocsExpiringRawRow = {
  vehicleId: string;
  vehicleCode: string;
  bookingId: string;
  bookingReference: string;
  pickupDateTime: Date;
  expiringDoc: "rego" | "ctp" | "insurance";
  expiresAt: Date;
};

type StatusMismatchRawRow = {
  vehicleId: string;
  vehicleCode: string;
  vehicleStatus: string;
  observed: "AVAILABLE_BUT_ON_HIRE" | "RENTED_BUT_NO_ACTIVE_BOOKING";
  bookingId: string | null;
  bookingReference: string | null;
};

export async function findCalendarMistakes(
  depotId?: string,
  db: PrismaLike = sharedPrisma,
): Promise<CalendarMistakes> {
  const depotClause = depotId ? Prisma.sql`AND b."depotId" = ${depotId}` : Prisma.empty;
  const vehicleDepotClause = depotId ? Prisma.sql`AND v."depotId" = ${depotId}` : Prisma.empty;

  // The remaining queries interpolate `now` into raw SQL, so run the one
  // date-independent query first and only then read the clock — prerender
  // contract, see incidentsSummary in admin-risk-signals.ts.
  const unallocatedRaw = await db.booking.findMany({
    where: {
      status: { in: ["ACTIVE", "CHECKED_OUT"] },
      vehicleId: null,
      ...(depotId ? { depotId } : {}),
    },
    include: {
      category: { select: { name: true } },
      customer: { select: { firstName: true, lastName: true } },
    },
    orderBy: { pickupDateTime: "asc" },
    take: 20,
  });
  const now = new Date();

  const [maintenanceRaw, docsRaw, mismatchRaw] = await Promise.all([
    db.$queryRaw<MaintenanceConflictRawRow[]>(Prisma.sql`
      SELECT
        b.id AS "bookingId",
        b."bookingReference",
        b."pickupDateTime",
        b."returnDateTime",
        v."internalCode" AS "vehicleCode",
        wo.id AS "workOrderId",
        wo."workOrderNumber",
        wo."scheduledStartAt",
        wo."scheduledEndAt"
      FROM "Booking" b
      JOIN "Vehicle" v ON v.id = b."vehicleId"
      JOIN "MaintenanceWorkOrder" wo ON wo."vehicleId" = b."vehicleId"
      WHERE b.status = 'CONFIRMED'
        AND b."vehicleId" IS NOT NULL
        AND b."pickupDateTime" >= ${now}
        AND wo.status IN ('OPEN','ASSIGNED','IN_PROGRESS','AWAITING_PARTS')
        AND wo."scheduledStartAt" IS NOT NULL
        AND wo."scheduledEndAt" IS NOT NULL
        AND wo."scheduledStartAt" < b."returnDateTime"
        AND wo."scheduledEndAt" > b."pickupDateTime"
        ${depotClause}
      ORDER BY b."pickupDateTime" ASC
      LIMIT 200
    `),
    db.$queryRaw<DocsExpiringRawRow[]>(Prisma.sql`
      SELECT
        v.id AS "vehicleId",
        v."internalCode" AS "vehicleCode",
        b.id AS "bookingId",
        b."bookingReference",
        b."pickupDateTime",
        x."expiringDoc",
        x."expiresAt"
      FROM "Booking" b
      JOIN "Vehicle" v ON v.id = b."vehicleId"
      JOIN LATERAL (
        VALUES
          ('rego', v."regoExpiry"),
          ('ctp', v."ctpExpiry"),
          ('insurance', v."insuranceExpiry")
      ) AS x("expiringDoc", "expiresAt") ON x."expiresAt" IS NOT NULL AND x."expiresAt" < b."returnDateTime"
      WHERE b.status = 'CONFIRMED'
        AND b."vehicleId" IS NOT NULL
        AND b."pickupDateTime" >= ${now}
        ${depotClause}
      ORDER BY b."pickupDateTime" ASC
      LIMIT 200
    `),
    db.$queryRaw<StatusMismatchRawRow[]>(Prisma.sql`
      SELECT
        v.id AS "vehicleId",
        v."internalCode" AS "vehicleCode",
        v.status::text AS "vehicleStatus",
        CASE
          WHEN v.status = 'AVAILABLE' THEN 'AVAILABLE_BUT_ON_HIRE'
          ELSE 'RENTED_BUT_NO_ACTIVE_BOOKING'
        END AS observed,
        b.id AS "bookingId",
        b."bookingReference"
      FROM "Vehicle" v
      LEFT JOIN LATERAL (
        SELECT id, "bookingReference"
        FROM "Booking"
        WHERE "vehicleId" = v.id
          AND status IN ('ACTIVE','CHECKED_OUT','OVERDUE')
          AND "pickupDateTime" <= ${now}
          AND "returnDateTime" >= ${now}
        LIMIT 1
      ) b ON TRUE
      WHERE v."isActive" = true
        AND v.status IN ('AVAILABLE','RENTED')
        AND (
          (v.status = 'AVAILABLE' AND b.id IS NOT NULL)
          OR (v.status = 'RENTED' AND b.id IS NULL)
        )
        ${vehicleDepotClause}
      LIMIT 200
    `),
  ]);

  const unallocated: UnallocatedBooking[] = unallocatedRaw.map((b) => ({
    id: b.id,
    bookingReference: b.bookingReference,
    status: b.status,
    pickupDateTime: b.pickupDateTime,
    categoryName: b.category.name,
    customerName: `${b.customer.firstName} ${b.customer.lastName}`,
  }));

  const maintenanceConflicts: MaintenanceConflictRow[] = maintenanceRaw;
  const docsExpiringWithBooking: DocsExpiringRow[] = docsRaw;
  const statusMismatches: StatusMismatchRow[] = mismatchRaw.map((r) => ({
    vehicleId: r.vehicleId,
    vehicleCode: r.vehicleCode,
    vehicleStatus: r.vehicleStatus,
    observed: r.observed,
    ...(r.bookingId ? { bookingId: r.bookingId } : {}),
    ...(r.bookingReference ? { bookingReference: r.bookingReference } : {}),
  }));

  return {
    unallocated,
    maintenanceConflicts,
    statusMismatches,
    docsExpiringWithBooking,
    total:
      unallocated.length +
      maintenanceConflicts.length +
      statusMismatches.length +
      docsExpiringWithBooking.length,
  };
}

export type TyreAlert = {
  vehicleId: string;
  internalCode: string;
  make: string;
  model: string;
  reason: "LOW_TREAD" | "STALE_INSPECTION" | "HIGH_KM_SINCE_REPLACEMENT";
  frontDepthMm: number | null;
  rearDepthMm: number | null;
  lastInspectedAt: Date | null;
  currentOdometerKm: number;
  kmSinceLastTyreWorkOrder: number | null;
};

export async function findTyreAlerts(
  depotId?: string,
  db: PrismaLike = sharedPrisma,
): Promise<TyreAlert[]> {
  const vehicles = await db.vehicle.findMany({
    where: {
      isActive: true,
      status: { notIn: ["SOLD", "END_OF_LIFE", "WRITTEN_OFF", "STOLEN"] },
      ...(depotId ? { depotId } : {}),
    },
    select: {
      id: true,
      internalCode: true,
      make: true,
      model: true,
      currentOdometerKm: true,
      inspections: {
        where: { type: { in: ["PRE_HIRE", "POST_HIRE", "ROUTINE"] } },
        orderBy: { dateTime: "desc" },
        take: 1,
        select: { dateTime: true, tyreFrontDepth: true, tyreRearDepth: true },
      },
      workOrders: {
        where: { type: "TYRE_REPLACEMENT", status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 1,
        select: { odometerAtService: true, completedAt: true },
      },
    },
  });

  const alerts: TyreAlert[] = [];
  // Read the clock only after the query above — prerender contract, see
  // incidentsSummary in admin-risk-signals.ts.
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - TYRE_RULES.inspectionStaleDays * 86_400_000);

  for (const v of vehicles) {
    const ins = v.inspections[0] ?? null;
    const lastTyreWo = v.workOrders[0] ?? null;
    const frontDepth = ins?.tyreFrontDepth != null ? Number(ins.tyreFrontDepth) : null;
    const rearDepth = ins?.tyreRearDepth != null ? Number(ins.tyreRearDepth) : null;
    const kmSinceTyreWo =
      lastTyreWo?.odometerAtService != null
        ? v.currentOdometerKm - lastTyreWo.odometerAtService
        : null;

    let reason: TyreAlert["reason"] | null = null;
    const minDepth = [frontDepth, rearDepth].filter((d): d is number => d != null).reduce(
      (acc, d) => (acc == null || d < acc ? d : acc),
      null as number | null,
    );
    if (minDepth != null && minDepth < TYRE_RULES.minTreadDepthMm) {
      reason = "LOW_TREAD";
    } else if (kmSinceTyreWo != null && kmSinceTyreWo > TYRE_RULES.warningKmSinceLastReplacement) {
      reason = "HIGH_KM_SINCE_REPLACEMENT";
    } else if (!ins || ins.dateTime < staleCutoff) {
      if (lastTyreWo == null && v.currentOdometerKm > TYRE_RULES.warningKmSinceLastReplacement) {
        reason = "HIGH_KM_SINCE_REPLACEMENT";
      } else if (ins && ins.dateTime < staleCutoff && minDepth == null) {
        reason = "STALE_INSPECTION";
      }
    }

    if (reason) {
      alerts.push({
        vehicleId: v.id,
        internalCode: v.internalCode,
        make: v.make,
        model: v.model,
        reason,
        frontDepthMm: frontDepth,
        rearDepthMm: rearDepth,
        lastInspectedAt: ins?.dateTime ?? null,
        currentOdometerKm: v.currentOdometerKm,
        kmSinceLastTyreWorkOrder: kmSinceTyreWo,
      });
    }
  }

  return alerts.sort((a, b) => {
    const aDepth = Math.min(a.frontDepthMm ?? Infinity, a.rearDepthMm ?? Infinity);
    const bDepth = Math.min(b.frontDepthMm ?? Infinity, b.rearDepthMm ?? Infinity);
    return aDepth - bDepth;
  });
}
